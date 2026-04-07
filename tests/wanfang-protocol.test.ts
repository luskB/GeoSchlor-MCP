import { describe, expect, it } from "vitest";
import {
  buildWanfangDetailRequestFrame,
  buildWanfangReferenceListRequestFrame,
  buildWanfangSearchRequestFrame,
  parseWanfangDetailResponse,
  parseWanfangReferenceCountResponse,
  parseWanfangSearchResponse
} from "../src/providers/wanfang-protocol.js";

describe("wanfang protocol helpers", () => {
  it("builds the grpc-web search request for all-resource search", () => {
    const frame = buildWanfangSearchRequestFrame("logging", 2, 30);
    const payload = readGrpcPayload(frame);
    const fields = decodeFields(payload);
    const commonRequest = decodeFields(asBuffer(fields[0].value));

    expect(fields.map((field) => field.fieldNo)).toEqual([1, 2, 4, 4, 12, 13]);
    expect(textValue(commonRequest, 1)).toBe("paper");
    expect(textValue(commonRequest, 2)).toBe("logging");
    expect(numberValue(commonRequest, 5)).toBe(2);
    expect(numberValue(commonRequest, 6)).toBe(30);
    expect(textValue(fields, 12)).toBe("pc");
    expect(textValue(fields, 13)).toBe("search");
  });

  it("parses a protocol search response into structured article records", () => {
    const resource = buildPeriodicalResource({
      id: "sydqwlkt202601005",
      zhTitle: "基于格兰杰因果图神经网络的测井曲线重构方法",
      enTitle: "Reconstruction method of logging curves based on GCGNN",
      authors: ["韩建", "陈着"],
      institutions: ["东北石油大学物理与电子工程学院,黑龙江大庆 163318"],
      zhKeywords: ["格兰杰因果图神经网络", "曲线重构"],
      enKeywords: ["logging", "curve reconstruction"],
      subjects: ["测井数据", "复杂地质条件"],
      abstractParts: [
        "在地质勘探中,密度和声波时差曲线能够反映地下地质结构和储层孔隙度等关键物性参数.",
        "然而,在复杂地质条件等因素的影响下,测井数据可能存在缺失现象.",
        "Logging data may be incomplete or missing under complex geological conditions."
      ],
      journalZh: "石油地球物理勘探",
      journalEn: "Oil Geophysical Prospecting",
      publicationDate: "2026-02-15 00:00:00",
      year: 2026,
      volume: "52",
      issue: "1",
      pages: "46-54",
      citationCount: "9",
      ranks: ["CSCD", "EI"],
      pdfPath: "sydqwlkt/sydq2026/2601pdf/260105.pdf",
      doi: "10.13810/j.cnki.issn.1000-7210.20250032",
      authorInstitutionPairs: [
        "韩建:东北石油大学物理与电子工程学院,黑龙江大庆 163318"
      ],
      language: "chi",
      issn: "1000-7210",
      cn: "13-1095/TE",
      resourceClass: "Regular",
      accessFlags: ["FULLTEXT", "WF_Free"],
      sourceCategory: "QK_CHI"
    });
    const response = buildGrpcResponse(
      concatFields([
        varintField(1, 1),
        stringField(2, "qid=test,"),
        varintField(3, 55706),
        bytesField(
          4,
          concatFields([
            stringField(1, "Periodical"),
            bytesField(2, buildPermissionEntry(15, "AI_READ")),
            bytesField(2, buildPermissionEntry(3, "FREE_DOWNLOAD")),
            bytesField(101, resource)
          ])
        )
      ])
    );

    const parsed = parseWanfangSearchResponse(response);

    expect(parsed.total).toBe(55706);
    expect(parsed.qid).toBe("qid=test,");
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]).toMatchObject({
      id: "sydqwlkt202601005",
      title: "基于格兰杰因果图神经网络的测井曲线重构方法",
      journal: "石油地球物理勘探",
      year: 2026,
      volume: "52",
      issue: "1",
      pages: "46-54",
      doi: "10.13810/j.cnki.issn.1000-7210.20250032",
      access: "open",
      language: "Chinese",
      detailUrl: "https://d.wanfangdata.com.cn/periodical/sydqwlkt202601005",
      citationCount: 9
    });
    expect(parsed.items[0].keywords).toContain("curve reconstruction");
    expect(parsed.items[0].subjects).toContain("测井数据");
    expect(parsed.items[0].institutions).toContain(
      "东北石油大学物理与电子工程学院,黑龙江大庆 163318"
    );
  });

  it("parses a protocol detail response and keeps metadata entries", () => {
    const resource = buildPeriodicalResource({
      id: "bjhkhtdxxb202601035",
      zhTitle: "基于快速傅里叶卷积的电成像测井图像修复",
      enTitle: "Inpainting of electrical imaging logging images based on fast Fourier convolution",
      authors: ["苏乾潇", "乔德新"],
      institutions: ["中国石油勘探开发研究院,北京 100083"],
      zhKeywords: ["电成像测井", "图像修复"],
      enKeywords: ["electrical imaging logging", "image inpainting"],
      subjects: ["储层测井评价", "复杂储层"],
      abstractParts: [
        "成像测井是复杂储层测井评价中的重要技术手段.",
        "Imaging logging is an important technique for complex reservoir evaluation."
      ],
      journalZh: "北京航空航天大学学报",
      journalEn: "Journal of Beijing University of Aeronautics and Astronautics",
      publicationDate: "2026-01-31 00:00:00",
      year: 2026,
      volume: "52",
      issue: "1",
      pages: "362-370",
      citationCount: "9",
      ranks: ["ISTIC", "EI"],
      pdfPath: "bjhkhtdxxb/bjhk2026/2601pdf/260135.pdf",
      doi: "10.13700/j.bh.1001-5965.2023.0754",
      authorInstitutionPairs: ["苏乾潇:中国石油勘探开发研究院,北京 100083"],
      language: "chi",
      issn: "1001-5965",
      cn: "11-2625/V",
      resourceClass: "Regular",
      accessFlags: ["FULLTEXT"],
      sourceCategory: "QK_CHI"
    });
    const response = buildGrpcResponse(
      concatFields([
        bytesField(
          1,
          concatFields([
            bytesField(2, buildPermissionEntry(16, "HTML_READ")),
            bytesField(103, resource)
          ])
        ),
        bytesField(2, buildKeyValueEntry("Status", "SUCCESS")),
        bytesField(2, buildKeyValueEntry("originalclasscodeList", "P^天文学、地球科学$$$"))
      ])
    );

    const record = parseWanfangDetailResponse(
      response,
      "https://d.wanfangdata.com.cn/periodical/bjhkhtdxxb202601035"
    );

    expect(record).not.toBeNull();
    expect(record?.title).toBe("基于快速傅里叶卷积的电成像测井图像修复");
    expect(record?.detailUrl).toBe(
      "https://d.wanfangdata.com.cn/periodical/bjhkhtdxxb202601035"
    );
    expect(record?.raw?.detailMetadata).toMatchObject({
      Status: "SUCCESS",
      originalclasscodeList: "P^天文学、地球科学$$$"
    });
  });

  it("parses reference and quotation totals from grpc-web responses", () => {
    const response = buildGrpcResponse(
      concatFields([
        bytesField(1, stringField(1, "ref-1")),
        bytesField(1, stringField(1, "ref-2")),
        varintField(3, 14)
      ])
    );

    expect(parseWanfangReferenceCountResponse(response)).toBe(14);
  });

  it("builds detail and reference request frames", () => {
    const detailPayload = readGrpcPayload(
      buildWanfangDetailRequestFrame("bjhkhtdxxb202601035")
    );
    const detailFields = decodeFields(detailPayload);
    expect(textValue(detailFields, 1)).toBe("Periodical");
    expect(textValue(detailFields, 2)).toBe("bjhkhtdxxb202601035");

    const referencePayload = readGrpcPayload(
      buildWanfangReferenceListRequestFrame(
        "bjhkhtdxxb202601035",
        "Reference",
        "QK_CHI",
        "WF"
      )
    );
    const referenceFields = decodeFields(referencePayload);
    expect(textValue(referenceFields, 1)).toBe("bjhkhtdxxb202601035");
    expect(textValue(referenceFields, 2)).toBe("Reference");
    expect(numberValue(referenceFields, 3)).toBe(1);
    expect(textValue(referenceFields, 4)).toBe("SerialNum");
    expect(textValue(referenceFields, 9)).toBe("QK_CHI");
    expect(textValue(referenceFields, 10)).toBe("WF");
  });
});

interface PeriodicalFixture {
  id: string;
  zhTitle: string;
  enTitle: string;
  authors: string[];
  institutions: string[];
  zhKeywords: string[];
  enKeywords: string[];
  subjects: string[];
  abstractParts: string[];
  journalZh: string;
  journalEn: string;
  publicationDate: string;
  year: number;
  volume: string;
  issue: string;
  pages: string;
  citationCount: string;
  ranks: string[];
  pdfPath: string;
  doi: string;
  authorInstitutionPairs: string[];
  language: string;
  issn: string;
  cn: string;
  resourceClass: string;
  accessFlags: string[];
  sourceCategory: string;
}

function buildPeriodicalResource(fixture: PeriodicalFixture): Buffer {
  return concatFields([
    stringField(1, fixture.id),
    stringField(2, fixture.zhTitle),
    stringField(2, fixture.enTitle),
    ...fixture.authors.map((author) => stringField(3, author)),
    ...fixture.institutions.map((institution) => stringField(10, institution)),
    ...fixture.zhKeywords.map((keyword) => stringField(16, keyword)),
    ...fixture.enKeywords.map((keyword) => stringField(17, keyword)),
    ...fixture.subjects.map((subject) => stringField(18, subject)),
    ...fixture.abstractParts.map((part) => stringField(20, part)),
    stringField(23, fixture.journalZh),
    stringField(23, fixture.journalEn),
    stringField(28, fixture.publicationDate),
    varintField(33, fixture.year),
    stringField(34, fixture.issue),
    stringField(35, fixture.volume),
    stringField(36, fixture.pages),
    stringField(37, fixture.citationCount),
    ...fixture.ranks.map((rank) => stringField(39, rank)),
    stringField(40, fixture.pdfPath),
    stringField(41, fixture.doi),
    ...fixture.authorInstitutionPairs.map((pair) => stringField(42, pair)),
    stringField(44, fixture.language),
    stringField(45, fixture.issn),
    stringField(46, fixture.cn),
    stringField(53, fixture.resourceClass),
    stringField(54, "Periodical"),
    stringField(55, "WF"),
    ...fixture.accessFlags.map((flag) => stringField(74, flag)),
    stringField(79, "WF_Free"),
    stringField(81, fixture.sourceCategory)
  ]);
}

function buildPermissionEntry(code: number, label: string): Buffer {
  return concatFields([varintField(1, code), stringField(4, label)]);
}

function buildKeyValueEntry(key: string, value: string): Buffer {
  return concatFields([stringField(1, key), stringField(2, value)]);
}

function buildGrpcResponse(message: Buffer): Buffer {
  const frame = Buffer.alloc(5);
  frame[0] = 0;
  frame.writeUInt32BE(message.length, 1);
  return Buffer.concat([frame, message]);
}

function readGrpcPayload(frame: Buffer): Buffer {
  return frame.subarray(5, 5 + frame.readUInt32BE(1));
}

function concatFields(fields: Buffer[]): Buffer {
  return Buffer.concat(fields);
}

function stringField(fieldNo: number, value: string): Buffer {
  return bytesField(fieldNo, Buffer.from(value, "utf8"));
}

function bytesField(fieldNo: number, value: Buffer): Buffer {
  return Buffer.concat([
    encodeVarint((fieldNo << 3) | 2),
    encodeVarint(value.length),
    value
  ]);
}

function varintField(fieldNo: number, value: number): Buffer {
  return Buffer.concat([encodeVarint(fieldNo << 3), encodeVarint(value)]);
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

function decodeFields(buffer: Buffer): Array<{ fieldNo: number; wireType: number; value: number | Buffer }> {
  const fields: Array<{ fieldNo: number; wireType: number; value: number | Buffer }> = [];
  let offset = 0;

  while (offset < buffer.length) {
    const [tag, afterTag] = readVarint(buffer, offset);
    offset = afterTag;
    const fieldNo = tag >> 3;
    const wireType = tag & 0x07;

    if (wireType === 0) {
      const [value, nextOffset] = readVarint(buffer, offset);
      offset = nextOffset;
      fields.push({ fieldNo, wireType, value });
      continue;
    }

    if (wireType === 2) {
      const [length, nextOffset] = readVarint(buffer, offset);
      offset = nextOffset;
      const end = offset + length;
      fields.push({ fieldNo, wireType, value: buffer.subarray(offset, end) });
      offset = end;
      continue;
    }

    throw new Error(`Unsupported wire type ${wireType} in test decoder.`);
  }

  return fields;
}

function readVarint(buffer: Buffer, offset: number): [number, number] {
  let result = 0;
  let shift = 0;
  let cursor = offset;

  while (cursor < buffer.length) {
    const byte = buffer[cursor];
    result |= (byte & 0x7f) << shift;
    cursor += 1;
    if ((byte & 0x80) === 0) {
      return [result, cursor];
    }
    shift += 7;
  }

  throw new Error("Unexpected EOF while decoding varint in test.");
}

function textValue(
  fields: Array<{ fieldNo: number; value: number | Buffer }>,
  fieldNo: number
): string | undefined {
  const value = fields.find((field) => field.fieldNo === fieldNo)?.value;
  return Buffer.isBuffer(value) ? value.toString("utf8") : undefined;
}

function numberValue(
  fields: Array<{ fieldNo: number; value: number | Buffer }>,
  fieldNo: number
): number | undefined {
  const value = fields.find((field) => field.fieldNo === fieldNo)?.value;
  return typeof value === "number" ? value : undefined;
}

function asBuffer(value: number | Buffer): Buffer {
  if (!Buffer.isBuffer(value)) {
    throw new Error("Expected a buffer value in test fixture.");
  }
  return value;
}
