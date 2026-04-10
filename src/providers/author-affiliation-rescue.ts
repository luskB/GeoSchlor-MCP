import { SearchRequest } from "../types.js";
import { normalizeWhitespace, uniqueList } from "../utils/text.js";
import { ProviderContext } from "./base.js";
import {
  buildCrossrefSearchUrl,
  CrossrefAuthor,
  CrossrefItem,
  CrossrefListResponse
} from "./open-metadata.js";

interface OpenAlexInstitutionEntity {
  id?: string;
  display_name?: string;
}

interface OpenAlexInstitutionResponse {
  results?: OpenAlexInstitutionEntity[];
}

interface OpenAlexAuthorInstitution {
  id?: string;
  display_name?: string;
}

interface OpenAlexAuthorEntity {
  id?: string;
  display_name?: string;
  display_name_alternatives?: string[];
  relevance_score?: number;
  works_count?: number;
  last_known_institutions?: OpenAlexAuthorInstitution[];
}

interface OpenAlexAuthorResponse {
  results?: OpenAlexAuthorEntity[];
}

export interface ResolvedAuthorAffiliationFocus {
  rawAuthorTerms: string[];
  authorGroups: string[][];
  authorQueries: string[];
  institutionHint: string;
  affiliationQueries: string[];
  institutionIds: string[];
  topicHint?: string;
}

export function shouldAttemptAuthorAffiliationRescue(request: SearchRequest): boolean {
  if (request.mode === "author") {
    return true;
  }

  if (request.mode !== "keyword") {
    return false;
  }

  const normalized = normalizeWhitespace(request.query);
  if (!normalized || normalized.length > 180) {
    return false;
  }

  return Boolean(
    request.filters?.institution ||
      extractInstitutionHint(normalized) ||
      detectEnglishFullNames(normalized).length ||
      detectChineseNames(normalized).length >= 2
  );
}

export async function resolveAuthorAffiliationFocus(
  request: SearchRequest,
  context: ProviderContext
): Promise<ResolvedAuthorAffiliationFocus | null> {
  if (!shouldAttemptAuthorAffiliationRescue(request)) {
    return null;
  }

  const institutionHint =
    normalizeWhitespace(request.filters?.institution) ||
    extractInstitutionHint(request.query);
  if (!institutionHint) {
    return null;
  }

  const institutions = await lookupInstitutions(institutionHint, context);
  const institutionIds = uniqueList(
    institutions.map((institution) => normalizeWhitespace(institution.id)).filter(Boolean) as string[]
  );
  const affiliationQueries = uniqueList(
    [
      simplifyInstitutionName(institutionHint),
      ...institutions.flatMap((institution) => [
        normalizeWhitespace(institution.display_name),
        simplifyInstitutionName(institution.display_name)
      ])
    ].filter(Boolean) as string[]
  ).slice(0, 3);

  if (!affiliationQueries.length) {
    return null;
  }

  const authorTerms = extractAuthorTerms(request, institutionHint);
  if (!authorTerms.length) {
    return null;
  }

  const authorGroups = (
    await Promise.all(
      authorTerms.map((term) => resolveAuthorQueries(term, institutions, context))
    )
  )
    .map((group) => uniqueList(group).slice(0, 2))
    .filter((group) => group.length);

  const authorQueries = uniqueList(authorGroups.flat()).slice(0, 4);

  if (!authorQueries.length) {
    return null;
  }

  const topicHint = extractTopicHint(request.query, institutionHint, authorTerms);

  return {
    rawAuthorTerms: authorTerms,
    authorGroups,
    authorQueries,
    institutionHint,
    affiliationQueries,
    institutionIds,
    topicHint
  };
}

export async function searchCrossrefAuthorAffiliationCandidates(
  request: SearchRequest,
  context: ProviderContext,
  rows: number
): Promise<CrossrefItem[]> {
  const focus = await resolveAuthorAffiliationFocus(request, context);
  if (!focus) {
    return [];
  }

  const requestPlans = buildRescueRequestPlans(focus, rows);
  const merged = new Map<string, CrossrefItem>();

  for (const plan of requestPlans) {
    try {
      const response = await context.http.getJson<CrossrefListResponse>(
        buildCrossrefSearchUrl(request, {
          rows: plan.rows,
          authorQueries: plan.authorQueries,
          affiliationQuery: plan.affiliationQuery,
          bibliographicQuery: plan.bibliographicQuery
        })
      );

      for (const item of response.message.items ?? []) {
        if (!itemMatchesAuthorQueries(item, focus.authorQueries)) {
          continue;
        }
        if (
          focus.affiliationQueries.length &&
          !itemMatchesAffiliationQueries(item, focus.affiliationQueries)
        ) {
          continue;
        }

        const key = buildItemKey(item);
        if (key && !merged.has(key)) {
          merged.set(key, item);
        }
      }
    } catch {
      continue;
    }
  }

  return [...merged.values()];
}

function buildRescueRequestPlans(
  focus: ResolvedAuthorAffiliationFocus,
  rows: number
): Array<{
  rows: number;
  authorQueries: string[];
  affiliationQuery: string;
  bibliographicQuery?: string;
}> {
  const plans: Array<{
    rows: number;
    authorQueries: string[];
    affiliationQuery: string;
    bibliographicQuery?: string;
  }> = [];

  const primaryAuthors = focus.authorGroups
    .map((group) => group[0])
    .filter(Boolean)
    .slice(0, 2);

  for (const affiliationQuery of focus.affiliationQueries) {
    if (primaryAuthors.length > 1) {
      plans.push({
        rows,
        authorQueries: primaryAuthors,
        affiliationQuery,
        bibliographicQuery: focus.topicHint
      });
    }

    for (const authorGroup of focus.authorGroups.slice(0, 2)) {
      for (const authorQuery of authorGroup.slice(0, 2)) {
        plans.push({
          rows,
          authorQueries: [authorQuery],
          affiliationQuery,
          bibliographicQuery: focus.topicHint
        });
      }
    }
  }

  return plans;
}

function extractAuthorTerms(request: SearchRequest, institutionHint: string): string[] {
  const query = normalizeWhitespace(request.query);
  if (!query) {
    return [];
  }

  const stripped = normalizeWhitespace(
    query
      .replace(institutionHint, " ")
      .replace(/[,;，；/|]+/g, " ")
      .replace(
        /\b(?:papers?|literature|article|articles|teacher|researcher|professor|author|authors|journal|journals|latest|recent|logging|well\s+logging|acoustic\s+logging)\b/gi,
        " "
      )
      .replace(
        /(论文|文献|文章|老师|教授|研究员|作者|期刊|最新|近年|测井|声波测井|电成像测井|随钻测井|地球物理|石油|中国|大学)/g,
        " "
      )
  );

  if (request.mode === "author") {
    const direct = uniqueList([
      ...detectEnglishFullNames(stripped),
      ...detectChineseNames(stripped),
      stripped
    ]);
    return direct.slice(0, 3);
  }

  return uniqueList([
    ...detectEnglishFullNames(stripped),
    ...detectChineseNames(stripped)
  ]).slice(0, 3);
}

function extractInstitutionHint(query: string): string | undefined {
  const normalized = normalizeWhitespace(query);
  if (!normalized) {
    return undefined;
  }

  const chineseMatches = normalized.match(
    /[\u4e00-\u9fff]{2,24}(?:大学|学院|研究院|研究所|实验室|公司)(?:（[^）]+）|\([^)]*\)|[\u4e00-\u9fff]{0,8})?/g
  );
  if (chineseMatches?.length) {
    return chineseMatches.sort((left, right) => right.length - left.length)[0];
  }

  const englishMatch = normalized.match(
    /\b(?:[A-Z][A-Za-z&.'-]*\s+){0,8}(?:University|College|Institute|School|Academy|Laboratory|Centre|Center|Corporation|Company)(?:\s+of\s+[A-Z][A-Za-z&.'-]+)?(?:,\s*[A-Z][A-Za-z .'-]+)?/i
  );
  return normalizeWhitespace(englishMatch?.[0]);
}

function detectChineseNames(query: string): string[] {
  return uniqueList(
    (query.match(/[\u4e00-\u9fff]{2,4}/g) ?? []).filter(
      (value) =>
        !/^(中国|石油|大学|学院|研究院|研究所|实验室|公司|测井|声波|文献|论文|文章|老师|教授|作者)$/.test(
          value
        )
    )
  );
}

function detectEnglishFullNames(query: string): string[] {
  const titleCaseTokens = query
    .split(/\s+/)
    .map((value) => value.trim())
    .filter((value) => /^[A-Z][A-Za-z'-]+$/.test(value));
  if (
    titleCaseTokens.length >= 4 &&
    titleCaseTokens.length % 2 === 0 &&
    titleCaseTokens.length <= 6
  ) {
    return uniqueList(
      titleCaseTokens.reduce<string[]>((names, token, index) => {
        if (index % 2 === 0 && titleCaseTokens[index + 1]) {
          names.push(`${token} ${titleCaseTokens[index + 1]}`);
        }
        return names;
      }, [])
    );
  }

  const matches = query.match(
    /\b[A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){1,2}\b/g
  );
  return uniqueList(
    (matches ?? []).filter(
      (value) =>
        !/\b(?:China|University|Petroleum|Engineering|Journal|Logging|School|Institute)\b/i.test(
          value
        )
    )
  );
}

async function lookupInstitutions(
  institutionHint: string,
  context: ProviderContext
): Promise<OpenAlexInstitutionEntity[]> {
  try {
    const params = new URLSearchParams({
      search: institutionHint,
      "per-page": "5"
    });
    if (context.config.openAlexMailto) {
      params.set("mailto", context.config.openAlexMailto);
    }
    const response = await context.http.getJson<OpenAlexInstitutionResponse>(
      `https://api.openalex.org/institutions?${params.toString()}`
    );
    return response.results ?? [];
  } catch {
    return [];
  }
}

async function resolveAuthorQueries(
  authorTerm: string,
  institutions: OpenAlexInstitutionEntity[],
  context: ProviderContext
): Promise<string[]> {
  const normalized = normalizeWhitespace(authorTerm);
  if (!normalized) {
    return [];
  }

  if (!/[\u4e00-\u9fff]/.test(normalized)) {
    return uniqueList([normalized, reversePersonName(normalized)]).slice(0, 2);
  }

  try {
    const params = new URLSearchParams({
      search: normalized,
      "per-page": "8"
    });
    if (context.config.openAlexMailto) {
      params.set("mailto", context.config.openAlexMailto);
    }

    const response = await context.http.getJson<OpenAlexAuthorResponse>(
      `https://api.openalex.org/authors?${params.toString()}`
    );
    const candidates = (response.results ?? [])
      .map((candidate) => ({
        candidate,
        score: scoreAuthorCandidate(candidate, normalized, institutions)
      }))
      .filter((entry) => entry.score >= 70)
      .sort((left, right) => right.score - left.score)
      .slice(0, 2);

    return uniqueList(
      candidates.flatMap((entry) =>
        [
          normalizeWhitespace(entry.candidate.display_name),
          reversePersonName(entry.candidate.display_name),
          ...(entry.candidate.display_name_alternatives ?? [])
            .map((value) => normalizeWhitespace(value))
            .filter((value) => /[A-Za-z]/.test(value ?? ""))
        ].filter(Boolean) as string[]
      )
    );
  } catch {
    return [];
  }
}

function scoreAuthorCandidate(
  author: OpenAlexAuthorEntity,
  rawTerm: string,
  institutions: OpenAlexInstitutionEntity[]
): number {
  const normalizedRaw = normalizeWhitespace(rawTerm);
  const institutionIds = new Set(
    institutions.map((institution) => normalizeWhitespace(institution.id)).filter(Boolean)
  );
  const institutionNames = institutions
    .map((institution) => normalizeWhitespace(institution.display_name).toLowerCase())
    .filter(Boolean);
  const names = [
    normalizeWhitespace(author.display_name),
    ...(author.display_name_alternatives ?? []).map((value) => normalizeWhitespace(value))
  ].filter(Boolean);

  let score = 0;
  if (names.includes(normalizedRaw)) {
    score += 120;
  } else if (names.some((name) => name.includes(normalizedRaw) || normalizedRaw.includes(name))) {
    score += 80;
  }

  const matchedInstitution = (author.last_known_institutions ?? []).some((institution) => {
    const id = normalizeWhitespace(institution.id);
    const displayName = normalizeWhitespace(institution.display_name).toLowerCase();
    return (id && institutionIds.has(id)) || institutionNames.some((name) => displayName.includes(name));
  });

  if (matchedInstitution) {
    score += 120;
  }

  score += Math.min(author.relevance_score ?? 0, 40);
  score += Math.min((author.works_count ?? 0) / 20, 20);
  return score;
}

function reversePersonName(value: string | undefined): string {
  const parts = normalizeWhitespace(value).split(" ").filter(Boolean);
  if (parts.length !== 2) {
    return normalizeWhitespace(value);
  }
  return `${parts[1]} ${parts[0]}`;
}

function simplifyInstitutionName(value: string | undefined): string {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return "";
  }

  return normalized.replace(/,\s*(East China|Beijing|Qingdao|China)$/i, "").trim();
}

function extractTopicHint(
  query: string,
  institutionHint: string,
  authorTerms: string[]
): string | undefined {
  const normalized = normalizeWhitespace(query)
    .replace(institutionHint, " ")
    .replace(
      new RegExp(authorTerms.map(escapeRegex).filter(Boolean).join("|"), "gi"),
      " "
    )
    .replace(/[,;，；/|]+/g, " ")
    .replace(
      /(论文|文献|文章|老师|教授|研究员|作者|期刊|最新|近年|中国|石油|大学)/g,
      " "
    )
    .replace(/\b(?:papers?|literature|articles?|teacher|researcher|professor|author|authors|journal|journals|latest|recent)\b/gi, " ");

  const lowered = normalized.toLowerCase();
  if (/声波测井|acoustic\s+logging/i.test(normalized)) {
    return "acoustic logging";
  }
  if (/随钻测井|logging while drilling|lwd/i.test(normalized)) {
    return "logging while drilling";
  }
  if (/测井|well\s+logging|logging/i.test(normalized)) {
    return "well logging";
  }
  if (/地震|seismic/i.test(normalized)) {
    return "seismic";
  }

  const englishTerms = lowered
    .split(/\s+/)
    .map((value) => value.trim())
    .filter((value) => /^[a-z][a-z-]{2,}$/.test(value));

  return englishTerms.slice(0, 3).join(" ") || undefined;
}

function itemMatchesAuthorQueries(item: CrossrefItem, authorQueries: string[]): boolean {
  const normalizedAuthors = uniqueList(
    (item.author ?? []).flatMap((author) => collectAuthorNameVariants(author))
  ).map((value) => normalizePersonName(value));

  const normalizedQueries = uniqueList(authorQueries).map((value) => normalizePersonName(value));
  return normalizedQueries.some((query) =>
    normalizedAuthors.some(
      (author) => author === query || author.includes(query) || query.includes(author)
    )
  );
}

function itemMatchesAffiliationQueries(
  item: CrossrefItem,
  affiliationQueries: string[]
): boolean {
  const normalizedAffiliations = uniqueList(
    (item.author ?? []).flatMap((author) =>
      (author.affiliation ?? []).map((affiliation) => normalizeWhitespace(affiliation.name))
    )
  ).map((value) => value.toLowerCase());
  const normalizedQueries = uniqueList(affiliationQueries).map((value) => value.toLowerCase());

  return normalizedQueries.some((query) =>
    normalizedAffiliations.some(
      (affiliation) => affiliation.includes(query) || query.includes(affiliation)
    )
  );
}

function collectAuthorNameVariants(author: CrossrefAuthor): string[] {
  return uniqueList(
    [
      normalizeWhitespace(author.name),
      normalizeWhitespace([author.given, author.family].filter(Boolean).join(" ")),
      normalizeWhitespace([author.family, author.given].filter(Boolean).join(" "))
    ].filter(Boolean) as string[]
  );
}

function normalizePersonName(value: string | undefined): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildItemKey(item: CrossrefItem): string {
  return normalizeWhitespace(item.DOI) || normalizeWhitespace(item.title?.[0]);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
