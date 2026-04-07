import { ArticleRecord, AccessKind } from "../types.js";
import { normalizeDoi, normalizeWhitespace, uniqueList } from "../utils/text.js";

const GRPC_DATA_FRAME = 0x00;
const GRPC_TRAILER_FRAME = 0x80;
const WANFANG_INTERFACE_TYPE = "pc";
const WANFANG_INTERFACE_NAME = "search";
const WANFANG_AI_PERMISSIONS = ["AI_READ", "AI_EXTRACT"] as const;
const WANFANG_PERIODICAL_TYPE = "Periodical";
const WANFANG_THESIS_TYPE = "Thesis";
const WANFANG_CONFERENCE_TYPE = "Conference";
const WANFANG_PROVIDER_CODE = "WF";
const WANFANG_SOURCE_CATEGORY = "QK_CHI";

interface ProtoField {
  fieldNo: number;
  wireType: number;
  value: number | Buffer;
}

interface WanfangResourceEnvelope {
  permissions: string[];
  resourceType?: string;
  resource: ArticleRecord | null;
}

interface WanfangResourceOptions {
  permissions: string[];
  detailUrl?: string;
}

export interface WanfangSearchResponse {
  total: number;
  qid?: string;
  items: ArticleRecord[];
}

export function buildWanfangSearchRequestFrame(
  query: string,
  page: number,
  pageSize: number,
  searchType = "paper"
): Buffer {
  const commonRequest = Buffer.concat([
    encodeStringField(1, searchType),
    encodeStringField(2, query),
    encodeVarintField(5, page),
    encodeVarintField(6, pageSize),
    encodeBytesField(8, Buffer.from([0])),
    encodeVarintField(9, 1)
  ]);
  const message = Buffer.concat([
    encodeBytesField(1, commonRequest),
    encodeVarintField(2, 1),
    ...WANFANG_AI_PERMISSIONS.map((permission) => encodeStringField(4, permission)),
    encodeStringField(12, WANFANG_INTERFACE_TYPE),
    encodeStringField(13, WANFANG_INTERFACE_NAME)
  ]);

  return wrapGrpcFrame(message);
}

export function buildWanfangDetailRequestFrame(
  resourceId: string,
  resourceType = WANFANG_PERIODICAL_TYPE
): Buffer {
  const message = Buffer.concat([
    encodeStringField(1, resourceType),
    encodeStringField(2, resourceId),
    ...WANFANG_AI_PERMISSIONS.map((permission) => encodeStringField(7, permission))
  ]);

  return wrapGrpcFrame(message);
}

export function buildWanfangReferenceListRequestFrame(
  resourceId: string,
  listType: "Quotation" | "Reference",
  sourceCategory = WANFANG_SOURCE_CATEGORY,
  providerCode = WANFANG_PROVIDER_CODE
): Buffer {
  const sortField = listType === "Quotation" ? "ArticleId" : "SerialNum";
  const message = Buffer.concat([
    encodeStringField(1, resourceId),
    encodeStringField(2, listType),
    encodeVarintField(3, 1),
    encodeStringField(4, sortField),
    encodeStringField(9, sourceCategory),
    encodeStringField(10, providerCode)
  ]);

  return wrapGrpcFrame(message);
}

export function parseWanfangSearchResponse(responseBody: Buffer): WanfangSearchResponse {
  const payload = extractGrpcPayload(responseBody);
  let total = 0;
  let qid: string | undefined;
  const items: ArticleRecord[] = [];

  forEachProtoField(payload, (field) => {
    if (field.fieldNo === 2 && isBuffer(field.value)) {
      qid = decodeString(field.value);
      return;
    }
    if (field.fieldNo === 3 && typeof field.value === "number") {
      total = field.value;
      return;
    }
    if (field.fieldNo === 4 && isBuffer(field.value)) {
      const entry = parseWanfangSearchEnvelope(field.value);
      if (entry.resource) {
        items.push(entry.resource);
      }
    }
  });

  return {
    total,
    qid,
    items
  };
}

export function parseWanfangDetailResponse(
  responseBody: Buffer,
  detailUrl?: string
): ArticleRecord | null {
  const payload = extractGrpcPayload(responseBody);
  let record: ArticleRecord | null = null;
  const metadata: Record<string, string> = {};

  forEachProtoField(payload, (field) => {
    if (field.fieldNo === 1 && isBuffer(field.value)) {
      record = parseWanfangDetailEnvelope(field.value, detailUrl);
      return;
    }
    if (field.fieldNo === 2 && isBuffer(field.value)) {
      const entry = parseWanfangKeyValueEntry(field.value);
      if (entry) {
        metadata[entry.key] = entry.value;
      }
    }
  });

  if (!record) {
    return null;
  }
  const detailRecord: ArticleRecord = record;

  return {
    ...detailRecord,
    raw: {
      ...(detailRecord.raw ?? {}),
      detailMetadata: metadata
    }
  };
}

export function parseWanfangReferenceCountResponse(responseBody: Buffer): number | undefined {
  const payload = extractGrpcPayload(responseBody);
  let count: number | undefined;
  let itemCount = 0;

  forEachProtoField(payload, (field) => {
    if (field.fieldNo === 1 && isBuffer(field.value)) {
      itemCount += 1;
      return;
    }
    if (field.fieldNo === 3 && typeof field.value === "number") {
      count = field.value;
    }
  });

  return count ?? (itemCount ? itemCount : 0);
}

function parseWanfangSearchEnvelope(buffer: Buffer): WanfangResourceEnvelope {
  const permissions: string[] = [];
  let resourceType: string | undefined;
  const resourceBuffers = new Map<number, Buffer>();

  forEachProtoField(buffer, (field) => {
    if (field.fieldNo === 1 && isBuffer(field.value)) {
      resourceType = decodeString(field.value);
      return;
    }
    if (field.fieldNo === 2 && isBuffer(field.value)) {
      const permission = parseWanfangPermission(field.value);
      if (permission) {
        permissions.push(permission);
      }
      return;
    }
    if (field.fieldNo >= 101 && field.fieldNo <= 110 && isBuffer(field.value)) {
      resourceBuffers.set(field.fieldNo, field.value);
    }
  });
  const record = parseWanfangResourceByType(resourceType, resourceBuffers, {
    permissions
  });

  if (record && resourceType) {
    record.raw = {
      ...(record.raw ?? {}),
      resourceType
    };
  }

  return {
    permissions,
    resourceType,
    resource: record
  };
}

function parseWanfangDetailEnvelope(
  buffer: Buffer,
  detailUrl?: string
): ArticleRecord | null {
  const permissions: string[] = [];
  const resourceBuffers = new Map<number, Buffer>();

  forEachProtoField(buffer, (field) => {
    if (field.fieldNo === 2 && isBuffer(field.value)) {
      const permission = parseWanfangPermission(field.value);
      if (permission) {
        permissions.push(permission);
      }
      return;
    }
    if (field.fieldNo >= 101 && field.fieldNo <= 110 && isBuffer(field.value)) {
      resourceBuffers.set(field.fieldNo, field.value);
    }
  });
  return (
    parseWanfangResourceByField(103, resourceBuffers, {
      permissions,
      detailUrl
    }) ??
    parseWanfangResourceByField(102, resourceBuffers, {
      permissions,
      detailUrl
    }) ??
    parseWanfangResourceByField(104, resourceBuffers, {
      permissions,
      detailUrl
    })
  );
}

function parseWanfangResourceByType(
  resourceType: string | undefined,
  resourceBuffers: Map<number, Buffer>,
  options: WanfangResourceOptions
): ArticleRecord | null {
  switch (normalizeWhitespace(resourceType)) {
    case WANFANG_PERIODICAL_TYPE:
      return parseWanfangResourceByField(101, resourceBuffers, options);
    case WANFANG_THESIS_TYPE:
      return parseWanfangResourceByField(102, resourceBuffers, options);
    case WANFANG_CONFERENCE_TYPE:
      return parseWanfangResourceByField(104, resourceBuffers, options);
    default:
      return null;
  }
}

function parseWanfangResourceByField(
  fieldNo: number,
  resourceBuffers: Map<number, Buffer>,
  options: WanfangResourceOptions
): ArticleRecord | null {
  const resourceBuffer = resourceBuffers.get(fieldNo);
  if (!resourceBuffer) {
    return null;
  }

  switch (fieldNo) {
    case 101:
    case 103:
      return parseWanfangPeriodicalResource(resourceBuffer, options);
    case 102:
      return parseWanfangThesisResource(resourceBuffer, options);
    case 104:
      return parseWanfangConferenceResource(resourceBuffer, options);
    default:
      return null;
  }
}

function parseWanfangPeriodicalResource(
  buffer: Buffer,
  options: WanfangResourceOptions
): ArticleRecord | null {
  const textFields = new Map<number, string[]>();
  const numberFields = new Map<number, number[]>();

  forEachProtoField(buffer, (field) => {
    if (typeof field.value === "number") {
      const values = numberFields.get(field.fieldNo) ?? [];
      values.push(field.value);
      numberFields.set(field.fieldNo, values);
      return;
    }
    if (isBuffer(field.value)) {
      const values = textFields.get(field.fieldNo) ?? [];
      values.push(decodeString(field.value));
      textFields.set(field.fieldNo, values);
    }
  });

  const resourceId = firstText(textFields, 1);
  const titles = cleanList(textFields.get(2));
  const title = titles[0];
  if (!resourceId || !title) {
    return null;
  }

  const translatedTitle = pickSecondaryLocalizedText(titles, title);
  const journalTitles = cleanList([
    ...(textFields.get(23) ?? []),
    ...(textFields.get(24) ?? [])
  ]);
  const journal = preferChineseText(journalTitles);
  const translatedJournal = pickSecondaryLocalizedText(journalTitles, journal);
  const abstractGroups = mergeLocalizedFragments(cleanList(textFields.get(20)));
  const keywordList = cleanList([
    ...(textFields.get(16) ?? []),
    ...(textFields.get(17) ?? [])
  ]);
  const subjects = cleanList(textFields.get(18));
  const institutions = uniqueList([
    ...cleanList(textFields.get(8)),
    ...cleanList(textFields.get(10)),
    ...extractInstitutionsFromPairs(cleanList(textFields.get(42)))
  ]);
  const publicationDates = cleanList(textFields.get(28));
  const journalRanks = cleanList(textFields.get(39));
  const accessFlags = cleanList([
    ...options.permissions,
    ...(textFields.get(74) ?? []),
    ...(textFields.get(79) ?? [])
  ]);
  const detailUrl =
    options.detailUrl ?? buildWanfangDetailUrl(resourceId, WANFANG_PERIODICAL_TYPE);
  const pdfPath = firstText(textFields, 40);
  const cn = firstText(textFields, 46);

  return {
    id: resourceId,
    source: "wanfang",
    title,
    authors: cleanList(textFields.get(3)),
    journal,
    year: firstNumber(numberFields, 33),
    volume: firstText(textFields, 35),
    issue: firstText(textFields, 34),
    pages: firstText(textFields, 36),
    doi: normalizeDoi(firstText(textFields, 41)),
    abstract: abstractGroups.join("\n\n") || undefined,
    keywords: keywordList.length ? keywordList : undefined,
    institutions: institutions.length ? institutions : undefined,
    language: mapWanfangLanguage(firstText(textFields, 44)),
    publicationDate: publicationDates[0] || undefined,
    citationCount: parseNumericText(firstText(textFields, 37)),
    sourceType: "journal-article",
    issn: cleanList(textFields.get(45)),
    subjects: subjects.length ? subjects : undefined,
    detailUrl,
    access: determineWanfangAccess(accessFlags),
    snippets: abstractGroups.length ? [abstractGroups[0]] : undefined,
    raw: {
      translatedTitle,
      translatedJournal,
      foreignAuthors: cleanList(textFields.get(6)),
      journalCode: firstText(textFields, 22),
      journalRanks,
      sourceDb: firstText(textFields, 25),
      resourceClass: firstText(textFields, 53),
      accessFlags,
      sourceCategory: firstText(textFields, 81),
      providerCode: firstText(textFields, 55),
      authorInstitutionPairs: cleanList(textFields.get(42)),
      publicationDates,
      pdfPath,
      cn,
      resourceType: WANFANG_PERIODICAL_TYPE
    }
  };
}

function parseWanfangThesisResource(
  buffer: Buffer,
  options: WanfangResourceOptions
): ArticleRecord | null {
  const textFields = new Map<number, string[]>();
  const numberFields = new Map<number, number[]>();

  forEachProtoField(buffer, (field) => {
    if (typeof field.value === "number") {
      const values = numberFields.get(field.fieldNo) ?? [];
      values.push(field.value);
      numberFields.set(field.fieldNo, values);
      return;
    }
    if (isBuffer(field.value)) {
      const values = textFields.get(field.fieldNo) ?? [];
      values.push(decodeString(field.value));
      textFields.set(field.fieldNo, values);
    }
  });

  const resourceId = firstText(textFields, 1);
  const title = firstText(textFields, 3);
  if (!resourceId || !title) {
    return null;
  }

  const accessFlags = cleanList([
    ...options.permissions,
    ...(textFields.get(57) ?? [])
  ]);
  const institutions = uniqueList([
    ...cleanList(textFields.get(6)),
    ...cleanList(textFields.get(8)),
    ...extractInstitutionsFromPairs(cleanList(textFields.get(32)))
  ]);
  const abstractGroups = mergeLocalizedFragments(cleanList(textFields.get(18)));
  const keywords = cleanList(textFields.get(16));
  const subjects = cleanList(textFields.get(14));

  return {
    id: resourceId,
    source: "wanfang",
    title,
    authors: cleanList(textFields.get(4)),
    year: firstNumber(numberFields, 26),
    doi: normalizeDoi(firstText(textFields, 41)),
    abstract: abstractGroups.join("\n\n") || undefined,
    keywords: keywords.length ? keywords : undefined,
    institutions: institutions.length ? institutions : undefined,
    language: mapWanfangLanguage(firstText(textFields, 31)),
    publisher: firstText(textFields, 8) ?? firstText(textFields, 6),
    publicationDate: firstText(textFields, 21),
    sourceType: "thesis",
    subjects: subjects.length ? subjects : undefined,
    detailUrl: options.detailUrl ?? buildWanfangDetailUrl(resourceId, WANFANG_THESIS_TYPE),
    access: determineWanfangAccess(accessFlags),
    snippets: abstractGroups.length ? [abstractGroups[0]] : undefined,
    raw: {
      degree: firstText(textFields, 30),
      discipline: firstText(textFields, 34),
      classCode: firstText(textFields, 10),
      sourceDb: firstText(textFields, 43) ?? firstText(textFields, 20),
      sourceCategory: firstText(textFields, 58),
      providerCode: firstText(textFields, 20) ?? firstText(textFields, 43),
      authorInstitutionPairs: cleanList(textFields.get(32)),
      accessFlags,
      resourceType: WANFANG_THESIS_TYPE
    }
  };
}

function parseWanfangConferenceResource(
  buffer: Buffer,
  options: WanfangResourceOptions
): ArticleRecord | null {
  const textFields = new Map<number, string[]>();
  const numberFields = new Map<number, number[]>();

  forEachProtoField(buffer, (field) => {
    if (typeof field.value === "number") {
      const values = numberFields.get(field.fieldNo) ?? [];
      values.push(field.value);
      numberFields.set(field.fieldNo, values);
      return;
    }
    if (isBuffer(field.value)) {
      const values = textFields.get(field.fieldNo) ?? [];
      values.push(decodeString(field.value));
      textFields.set(field.fieldNo, values);
    }
  });

  const resourceId = firstText(textFields, 1);
  const titles = cleanList(textFields.get(3));
  const title = titles.find(Boolean);
  if (!resourceId || !title) {
    return null;
  }

  const contributors = cleanList(textFields.get(4));
  const { authors, institutions } = splitConferenceContributors(contributors);
  const abstractGroups = mergeLocalizedFragments(cleanList(textFields.get(20)));
  const accessFlags = cleanList([
    ...options.permissions,
    ...(textFields.get(65) ?? [])
  ]);

  return {
    id: resourceId,
    source: "wanfang",
    title,
    authors,
    journal: firstText(textFields, 37),
    year: firstNumber(numberFields, 28),
    issue: firstText(textFields, 30),
    pages: firstText(textFields, 29),
    abstract: abstractGroups.join("\n\n") || undefined,
    institutions: institutions.length ? institutions : undefined,
    language: mapWanfangLanguage(firstText(textFields, 35)),
    publicationDate: firstText(textFields, 23),
    publisher: firstText(textFields, 22) ?? firstText(textFields, 47),
    sourceType: "conference-paper",
    subjects: cleanList(textFields.get(12)),
    detailUrl: options.detailUrl ?? buildWanfangDetailUrl(resourceId, WANFANG_CONFERENCE_TYPE),
    access: determineWanfangAccess(accessFlags),
    snippets: abstractGroups.length ? [abstractGroups[0]] : undefined,
    raw: {
      translatedTitle: pickSecondaryLocalizedText(titles, title),
      sourceDb: firstText(textFields, 47) ?? firstText(textFields, 22),
      accessFlags,
      resourceType: WANFANG_CONFERENCE_TYPE
    }
  };
}

function parseWanfangPermission(buffer: Buffer): string | undefined {
  let label: string | undefined;

  forEachProtoField(buffer, (field) => {
    if (field.fieldNo === 4 && isBuffer(field.value)) {
      label = decodeString(field.value);
    }
  });

  return normalizeWhitespace(label) || undefined;
}

function parseWanfangKeyValueEntry(
  buffer: Buffer
): { key: string; value: string } | null {
  let key = "";
  let value = "";

  forEachProtoField(buffer, (field) => {
    if (field.fieldNo === 1 && isBuffer(field.value)) {
      key = decodeString(field.value);
    }
    if (field.fieldNo === 2 && isBuffer(field.value)) {
      value = decodeString(field.value);
    }
  });

  key = normalizeWhitespace(key);
  value = normalizeWhitespace(value);
  return key && value ? { key, value } : null;
}

function determineWanfangAccess(flags: string[]): AccessKind {
  const normalized = flags.map((flag) => normalizeWhitespace(flag).toUpperCase());
  if (normalized.includes("FREE_DOWNLOAD") || normalized.includes("WF_FREE")) {
    return "open";
  }
  if (
    normalized.includes("DOWNLOAD") ||
    normalized.includes("FULLTEXT") ||
    normalized.includes("ONLINE_READ")
  ) {
    return "session_required";
  }
  return "unknown";
}

function splitConferenceContributors(values: string[]): {
  authors: string[];
  institutions: string[];
} {
  const authors: string[] = [];
  const institutions: string[] = [];

  for (const value of values) {
    const normalized = normalizeWhitespace(value);
    if (!normalized) {
      continue;
    }
    if (looksLikeInstitution(normalized)) {
      institutions.push(normalized);
      continue;
    }
    authors.push(normalized);
  }

  if (!authors.length && values[0]) {
    authors.push(values[0]);
  }
  if (!institutions.length && values.length > authors.length) {
    institutions.push(...values.slice(authors.length));
  }

  return {
    authors: uniqueList(authors),
    institutions: uniqueList(institutions)
  };
}

function looksLikeInstitution(value: string): boolean {
  return /(大学|学院|研究所|实验室|中心|委员会|公司|医院|所|Institute|University|College|Laboratory|Lab|Center|Centre|School|Engineer|Engineering)/i.test(
    value
  );
}

function mergeLocalizedFragments(fragments: string[]): string[] {
  const groups: { kind: "zh" | "latin"; text: string }[] = [];

  for (const fragment of fragments) {
    const clean = stripInlineMarkup(fragment);
    if (!clean) {
      continue;
    }
    const kind = detectTextKind(clean);
    const last = groups[groups.length - 1];
    if (last && last.kind === kind) {
      last.text = normalizeWhitespace(`${last.text}${clean}`);
      continue;
    }
    groups.push({ kind, text: clean });
  }

  return groups
    .map((group) => normalizeWhitespace(group.text))
    .filter(Boolean);
}

function detectTextKind(value: string): "zh" | "latin" {
  const chineseMatches = value.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const latinMatches = value.match(/[A-Za-z]/g)?.length ?? 0;
  return chineseMatches >= latinMatches ? "zh" : "latin";
}

function cleanList(values: string[] | undefined): string[] {
  return uniqueList(
    (values ?? [])
      .map((value) => stripInlineMarkup(value))
      .map((value) => normalizeWhitespace(value))
      .filter(Boolean)
  );
}

function stripInlineMarkup(value: string | undefined): string {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return "";
  }
  return normalizeWhitespace(normalized.replace(/<[^>]+>/g, ""));
}

function preferChineseText(values: string[]): string | undefined {
  const chinese = values.find((value) => /[\u3400-\u9fff]/.test(value));
  return chinese ?? values[0];
}

function pickSecondaryLocalizedText(
  values: string[],
  primary: string | undefined
): string | undefined {
  return values.find((value) => value && value !== primary);
}

function extractInstitutionsFromPairs(values: string[]): string[] {
  return values
    .map((value) => value.split(/[:：]/).slice(1).join(":"))
    .map((value) => normalizeWhitespace(value))
    .filter(Boolean);
}

function firstText(fields: Map<number, string[]>, fieldNo: number): string | undefined {
  return cleanList(fields.get(fieldNo))[0];
}

function firstNumber(fields: Map<number, number[]>, fieldNo: number): number | undefined {
  return fields.get(fieldNo)?.[0];
}

function parseNumericText(value: string | undefined): number | undefined {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return undefined;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function mapWanfangLanguage(code: string | undefined): string | undefined {
  switch ((normalizeWhitespace(code) || "").toLowerCase()) {
    case "chi":
      return "Chinese";
    case "eng":
      return "English";
    default:
      return normalizeWhitespace(code) || undefined;
  }
}

function buildWanfangDetailUrl(resourceId: string, resourceType: string): string {
  switch (resourceType) {
    case WANFANG_THESIS_TYPE:
      return `https://d.wanfangdata.com.cn/thesis/${resourceId}`;
    case WANFANG_CONFERENCE_TYPE:
      return `https://d.wanfangdata.com.cn/conference/${resourceId}`;
    case WANFANG_PERIODICAL_TYPE:
    default:
      return `https://d.wanfangdata.com.cn/periodical/${resourceId}`;
  }
}

function wrapGrpcFrame(payload: Buffer): Buffer {
  const header = Buffer.alloc(5);
  header[0] = GRPC_DATA_FRAME;
  header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

function extractGrpcPayload(responseBody: Buffer): Buffer {
  const payloads: Buffer[] = [];
  let offset = 0;

  while (offset + 5 <= responseBody.length) {
    const frameType = responseBody[offset];
    const frameLength = responseBody.readUInt32BE(offset + 1);
    offset += 5;

    if (offset + frameLength > responseBody.length) {
      break;
    }

    const frame = responseBody.subarray(offset, offset + frameLength);
    offset += frameLength;

    if (frameType === GRPC_DATA_FRAME) {
      payloads.push(frame);
      continue;
    }
    if (frameType === GRPC_TRAILER_FRAME) {
      continue;
    }
  }

  if (!payloads.length) {
    throw new Error("Wanfang grpc-web response did not contain a data frame.");
  }

  return Buffer.concat(payloads);
}

function forEachProtoField(buffer: Buffer, visitor: (field: ProtoField) => void): void {
  let offset = 0;
  while (offset < buffer.length) {
    const { value: tag, nextOffset: afterTag } = readVarint(buffer, offset);
    offset = afterTag;
    const fieldNo = tag >> 3;
    const wireType = tag & 0x07;

    switch (wireType) {
      case 0: {
        const { value, nextOffset } = readVarint(buffer, offset);
        offset = nextOffset;
        visitor({ fieldNo, wireType, value });
        break;
      }
      case 1: {
        const end = offset + 8;
        if (end > buffer.length) {
          throw new Error(`Unexpected EOF while reading fixed64 field ${fieldNo}.`);
        }
        visitor({
          fieldNo,
          wireType,
          value: Number(buffer.readBigUInt64LE(offset))
        });
        offset = end;
        break;
      }
      case 2: {
        const { value: length, nextOffset } = readVarint(buffer, offset);
        offset = nextOffset;
        const end = offset + length;
        if (end > buffer.length) {
          throw new Error(`Unexpected EOF while reading bytes field ${fieldNo}.`);
        }
        visitor({
          fieldNo,
          wireType,
          value: buffer.subarray(offset, end)
        });
        offset = end;
        break;
      }
      case 5: {
        const end = offset + 4;
        if (end > buffer.length) {
          throw new Error(`Unexpected EOF while reading fixed32 field ${fieldNo}.`);
        }
        visitor({
          fieldNo,
          wireType,
          value: buffer.readUInt32LE(offset)
        });
        offset = end;
        break;
      }
      default:
        throw new Error(`Unsupported protobuf wire type ${wireType} on field ${fieldNo}.`);
    }
  }
}

function encodeVarintField(fieldNo: number, value: number): Buffer {
  return Buffer.concat([encodeVarint((fieldNo << 3) | 0), encodeVarint(value)]);
}

function encodeStringField(fieldNo: number, value: string): Buffer {
  return encodeBytesField(fieldNo, Buffer.from(value, "utf8"));
}

function encodeBytesField(fieldNo: number, value: Buffer): Buffer {
  return Buffer.concat([
    encodeVarint((fieldNo << 3) | 2),
    encodeVarint(value.length),
    value
  ]);
}

function encodeVarint(value: number): Buffer {
  const bytes: number[] = [];
  let remaining = value >>> 0;

  while (remaining >= 0x80) {
    bytes.push((remaining & 0x7f) | 0x80);
    remaining >>>= 7;
  }
  bytes.push(remaining);
  return Buffer.from(bytes);
}

function readVarint(
  buffer: Buffer,
  offset: number
): { value: number; nextOffset: number } {
  let result = 0;
  let shift = 0;
  let cursor = offset;

  while (cursor < buffer.length) {
    const byte = buffer[cursor];
    result |= (byte & 0x7f) << shift;
    cursor += 1;
    if ((byte & 0x80) === 0) {
      return { value: result, nextOffset: cursor };
    }
    shift += 7;
  }

  throw new Error("Unexpected EOF while reading protobuf varint.");
}

function decodeString(buffer: Buffer): string {
  return buffer.toString("utf8");
}

function isBuffer(value: number | Buffer): value is Buffer {
  return Buffer.isBuffer(value);
}
