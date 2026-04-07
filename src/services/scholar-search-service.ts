import { AppConfig } from "../config.js";
import { HttpClient } from "../http/http-client.js";
import {
  OpenAlexResponse,
  OpenAlexWork,
  mapOpenAlexItemToRecord,
  mergeMetadataRecords
} from "../providers/open-metadata.js";
import { FileCache } from "../storage/file-cache.js";
import { ArticleRecord } from "../types.js";
import { buildQueryVariants } from "../utils/query-expansion.js";
import { normalizeWhitespace, uniqueList } from "../utils/text.js";

const SCHOLAR_CACHE_NAMESPACE = "scholar-openalex-v1";
const INSTITUTION_SEARCH_LIMIT = 5;
const AUTHOR_CANDIDATE_LIMIT = 5;
const AUTHOR_WORKS_FETCH_LIMIT = 3;
const INSTITUTION_WORKS_FETCH_LIMIT = 2;
const TOPIC_VARIANT_LIMIT = 3;
const WORKS_PER_QUERY = 50;

interface OpenAlexInstitutionEntity {
  id?: string;
  display_name?: string;
  relevance_score?: number;
  country_code?: string;
  works_count?: number;
}

interface OpenAlexInstitutionResponse {
  results: OpenAlexInstitutionEntity[];
}

interface OpenAlexAuthorInstitution {
  id?: string;
  display_name?: string;
}

interface OpenAlexAuthorEntity {
  id?: string;
  display_name?: string;
  display_name_alternatives?: string[];
  works_count?: number;
  cited_by_count?: number;
  relevance_score?: number;
  last_known_institutions?: OpenAlexAuthorInstitution[];
}

interface OpenAlexAuthorResponse {
  results: OpenAlexAuthorEntity[];
}

export interface ScholarSearchRequest {
  authorName: string;
  institution?: string;
  topic?: string;
  maxResults: number;
  yearFrom?: number;
  yearTo?: number;
}

export interface ScholarInstitutionCandidate {
  id: string;
  name: string;
  countryCode?: string;
  worksCount?: number;
  score: number;
}

export interface ScholarAuthorCandidate {
  id: string;
  displayName: string;
  aliases: string[];
  worksCount?: number;
  citedByCount?: number;
  institutions: string[];
  score: number;
}

export interface ScholarSearchItem extends ArticleRecord {
  source: "openalex";
  matchScore: number;
  matchSignals: string[];
  matchedAuthorAliases?: string[];
  matchedInstitutions?: string[];
  matchedTopicTerms?: string[];
  retrievalStrategies: string[];
}

export interface ScholarSearchResult {
  authorName: string;
  institution?: string;
  topic?: string;
  strategy: string;
  total: number;
  topicVariants: string[];
  institutionCandidates: ScholarInstitutionCandidate[];
  authorCandidates: ScholarAuthorCandidate[];
  notes: string[];
  items: ScholarSearchItem[];
}

interface CollectedWork {
  record: ArticleRecord;
  strategyNames: Set<string>;
  authorAliases: Set<string>;
  institutionNames: Set<string>;
  topicTerms: Set<string>;
  authorConfidence: number;
}

export class ScholarSearchService {
  constructor(
    private readonly config: AppConfig,
    private readonly http: HttpClient,
    private readonly cache: FileCache
  ) {}

  async search(request: ScholarSearchRequest): Promise<ScholarSearchResult> {
    const authorName = normalizeWhitespace(request.authorName);
    const institution = normalizeWhitespace(request.institution);
    const topic = normalizeWhitespace(request.topic);

    if (!authorName) {
      throw new Error("authorName is required.");
    }

    const institutionCandidates = institution
      ? await this.resolveInstitutionCandidates(institution)
      : [];
    const authorCandidates = await this.resolveAuthorCandidates(authorName, institutionCandidates);
    const topicVariants = buildTopicVariants(topic);

    const collectedWorks = new Map<string, CollectedWork>();
    const notes: string[] = [];

    if (institution && !institutionCandidates.length) {
      notes.push("Institution hint could not be resolved from OpenAlex, so author matching is less constrained.");
    } else if (institutionCandidates.length) {
      notes.push(
        `Resolved institution candidates from OpenAlex: ${institutionCandidates
          .slice(0, 3)
          .map((candidate) => candidate.name)
          .join(", ")}.`
      );
    }

    if (!authorCandidates.length) {
      notes.push("OpenAlex author resolution was ambiguous, so results rely more heavily on institution and topic matching.");
    } else {
      notes.push(
        `Resolved author candidates: ${authorCandidates
          .slice(0, 3)
          .map((candidate) => candidate.displayName)
          .join(", ")}.`
      );
    }

    if (topicVariants.length) {
      notes.push(`Topic variants used for scholar retrieval: ${topicVariants.join(" | ")}.`);
    } else {
      notes.push("No topic hint was provided, so results are ranked primarily by author and institution matching.");
    }

    await this.collectInstitutionTopicWorks(
      institutionCandidates,
      topicVariants,
      collectedWorks
    );
    await this.collectInstitutionAuthorWorks(
      institutionCandidates,
      authorCandidates,
      topicVariants,
      collectedWorks
    );
    if (!institutionCandidates.length || !collectedWorks.size) {
      await this.collectAuthorWorks(authorCandidates, topicVariants, collectedWorks, request);
    }

    if (!collectedWorks.size && institutionCandidates.length && !topicVariants.length) {
      notes.push("Institution candidates were resolved, but no topic was provided and no author-scoped works were found.");
    }

    const rankedItems = [...collectedWorks.values()]
      .map((candidate) => this.finalizeItem(candidate, authorName, topicVariants))
      .sort(compareScholarItems);
    const authorMatchedItems = rankedItems.filter(isHighConfidenceScholarItem);
    const items = (authorMatchedItems.length ? authorMatchedItems : rankedItems).slice(
      0,
      request.maxResults
    );

    if (authorMatchedItems.length && authorMatchedItems.length < rankedItems.length) {
      notes.push(
        "Lower-confidence institution/topic matches were hidden because higher-confidence author-matched scholar results were found."
      );
    }

    if (!items.length) {
      notes.push(
        "No confidently ranked scholar publications were found. Adding a specific topic, coauthor, or institution branch usually improves recall."
      );
    }

    return {
      authorName,
      institution: institution || undefined,
      topic: topic || undefined,
      strategy: "openalex-institution-and-author-rerank",
      total: items.length,
      topicVariants,
      institutionCandidates,
      authorCandidates,
      notes,
      items
    };
  }

  private async resolveInstitutionCandidates(
    institution: string
  ): Promise<ScholarInstitutionCandidate[]> {
    const response = await this.getCachedJson<OpenAlexInstitutionResponse>(
      `institutions/${encodeURIComponent(institution)}`,
      () => this.http.getJson(buildOpenAlexInstitutionUrl(this.config, institution))
    );

    const candidates = (response.results ?? []).flatMap((item) => {
        const id = normalizeWhitespace(item.id);
        const name = normalizeWhitespace(item.display_name);
        if (!id || !name) {
          return [];
        }

        return [{
          id,
          name,
          countryCode: normalizeWhitespace(item.country_code) || undefined,
          worksCount: item.works_count,
          score:
            (item.relevance_score ?? 0) +
            scoreExactTextMatch(institution, name) +
            scoreInstitutionAliasMatch(institution, name)
        } satisfies ScholarInstitutionCandidate];
      })
      .sort((left, right) => right.score - left.score);

    return candidates.slice(0, INSTITUTION_SEARCH_LIMIT);
  }

  private async resolveAuthorCandidates(
    authorName: string,
    institutionCandidates: ScholarInstitutionCandidate[]
  ): Promise<ScholarAuthorCandidate[]> {
    const collected = new Map<string, ScholarAuthorCandidate>();

    if (institutionCandidates.length) {
      for (const institution of institutionCandidates.slice(0, INSTITUTION_WORKS_FETCH_LIMIT)) {
        const scopedResults = await this.fetchAuthorCandidates(authorName, institution.id);
        for (const candidate of scopedResults) {
          upsertAuthorCandidate(collected, candidate);
        }
      }
    }

    if (!collected.size) {
      const fallbackResults = await this.fetchAuthorCandidates(authorName);
      for (const candidate of fallbackResults) {
        upsertAuthorCandidate(collected, candidate);
      }
    }

    return [...collected.values()]
      .sort((left, right) => right.score - left.score)
      .slice(0, AUTHOR_CANDIDATE_LIMIT);
  }

  private async fetchAuthorCandidates(
    authorName: string,
    institutionId?: string
  ): Promise<ScholarAuthorCandidate[]> {
    const filters = institutionId
      ? [
          `last_known_institutions.id:${institutionId}`,
          `affiliations.institution.id:${institutionId}`
        ]
      : [undefined];

    const collected: ScholarAuthorCandidate[] = [];
    for (const filter of filters) {
      const response = await this.getCachedJson<OpenAlexAuthorResponse>(
        `authors/${encodeURIComponent(authorName)}/${encodeURIComponent(filter ?? "all")}`,
        () => this.http.getJson(buildOpenAlexAuthorUrl(this.config, authorName, filter))
      );

      for (const item of response.results ?? []) {
        const id = normalizeWhitespace(item.id);
        const displayName = normalizeWhitespace(item.display_name);
        if (!id || !displayName) {
          continue;
        }

        const aliases = uniqueList([
          displayName,
          ...(item.display_name_alternatives ?? []).map((alias) => normalizeWhitespace(alias))
        ]);
        const institutions = uniqueList(
          (item.last_known_institutions ?? []).map((institution) =>
            normalizeWhitespace(institution.display_name)
          )
        );

        collected.push({
          id,
          displayName,
          aliases,
          worksCount: item.works_count,
          citedByCount: item.cited_by_count,
          institutions,
          score:
            (item.relevance_score ?? 0) +
            scoreAuthorAliasMatch(authorName, aliases) +
            (institutionId
              ? institutions.some((name) => normalizeWhitespace(name))
                ? 6
                : 0
              : 0) +
            Math.min(item.works_count ?? 0, 100) / 25
        });
      }
    }

    return collected;
  }

  private async collectInstitutionTopicWorks(
    institutionCandidates: ScholarInstitutionCandidate[],
    topicVariants: string[],
    collectedWorks: Map<string, CollectedWork>
  ): Promise<void> {
    if (!institutionCandidates.length || !topicVariants.length) {
      return;
    }

    for (const institution of institutionCandidates.slice(0, INSTITUTION_WORKS_FETCH_LIMIT)) {
      for (const topic of topicVariants.slice(0, TOPIC_VARIANT_LIMIT)) {
        const response = await this.getCachedJson<OpenAlexResponse>(
          `works/institution/${encodeURIComponent(institution.id)}/${encodeURIComponent(topic)}`,
          () =>
            this.http.getJson(
              buildOpenAlexWorksUrl(this.config, {
                filter: [`authorships.institutions.id:${institution.id}`],
                search: topic,
                perPage: WORKS_PER_QUERY
              })
            )
        );

        this.collectWorksFromResponse(response.results ?? [], collectedWorks, {
          strategy: "institution_topic",
          institutionName: institution.name,
          topicTerm: topic
        });
      }
    }
  }

  private async collectAuthorWorks(
    authorCandidates: ScholarAuthorCandidate[],
    topicVariants: string[],
    collectedWorks: Map<string, CollectedWork>,
    request: ScholarSearchRequest
  ): Promise<void> {
    for (const author of authorCandidates.slice(0, AUTHOR_WORKS_FETCH_LIMIT)) {
      const authorTopics = topicVariants.length ? topicVariants : [undefined];
      for (const topic of authorTopics.slice(0, TOPIC_VARIANT_LIMIT)) {
        const response = await this.getCachedJson<OpenAlexResponse>(
          `works/author/${encodeURIComponent(author.id)}/${encodeURIComponent(topic ?? "all")}/${request.yearFrom ?? "any"}/${request.yearTo ?? "any"}`,
          () =>
            this.http.getJson(
              buildOpenAlexWorksUrl(this.config, {
                filter: [
                  `author.id:${author.id}`,
                  request.yearFrom
                    ? `from_publication_date:${request.yearFrom}-01-01`
                    : undefined,
                  request.yearTo
                    ? `to_publication_date:${request.yearTo}-12-31`
                    : undefined
                ],
                search: topic,
                perPage: WORKS_PER_QUERY
              })
            )
        );

        this.collectWorksFromResponse(response.results ?? [], collectedWorks, {
          strategy: "author_works",
          author,
          topicTerm: topic
        });
      }
    }
  }

  private async collectInstitutionAuthorWorks(
    institutionCandidates: ScholarInstitutionCandidate[],
    authorCandidates: ScholarAuthorCandidate[],
    topicVariants: string[],
    collectedWorks: Map<string, CollectedWork>
  ): Promise<void> {
    if (!institutionCandidates.length || !authorCandidates.length) {
      return;
    }

    for (const institution of institutionCandidates.slice(0, INSTITUTION_WORKS_FETCH_LIMIT)) {
      for (const author of authorCandidates.slice(0, AUTHOR_WORKS_FETCH_LIMIT)) {
        const aliases = selectAuthorAliasQueries(author);
        const queries = topicVariants.length
          ? aliases.flatMap((alias) =>
              topicVariants
                .slice(0, TOPIC_VARIANT_LIMIT)
                .map((topic) => normalizeWhitespace(`${alias} ${topic}`))
            )
          : aliases;

        for (const query of uniqueList(queries).slice(0, TOPIC_VARIANT_LIMIT * 2)) {
          const response = await this.getCachedJson<OpenAlexResponse>(
            `works/institution-author/${encodeURIComponent(institution.id)}/${encodeURIComponent(query)}`,
            () =>
              this.http.getJson(
                buildOpenAlexWorksUrl(this.config, {
                  filter: [`authorships.institutions.id:${institution.id}`],
                  search: query,
                  perPage: WORKS_PER_QUERY
                })
              )
          );

          this.collectWorksFromResponse(response.results ?? [], collectedWorks, {
            strategy: "institution_author",
            author,
            institutionName: institution.name,
            topicTerm: topicVariants.find((topic) => query.toLowerCase().includes(topic.toLowerCase()))
          });
        }
      }
    }
  }

  private collectWorksFromResponse(
    items: OpenAlexWork[],
    collectedWorks: Map<string, CollectedWork>,
    options: {
      strategy: string;
      author?: ScholarAuthorCandidate;
      institutionName?: string;
      topicTerm?: string;
    }
  ): void {
    for (const item of items) {
      const record = mapOpenAlexItemToRecord("openalex", item);
      const key = normalizeWhitespace(record.doi ?? record.id);
      if (!key) {
        continue;
      }

      const existing = collectedWorks.get(key);
      const mergedRecord = existing
        ? mergeMetadataRecords([existing.record, record])[0]
        : record;

      const nextEntry: CollectedWork = existing ?? {
        record: mergedRecord,
        strategyNames: new Set<string>(),
        authorAliases: new Set<string>(),
        institutionNames: new Set<string>(),
        topicTerms: new Set<string>(),
        authorConfidence: 0
      };

      nextEntry.record = mergedRecord;
      nextEntry.strategyNames.add(options.strategy);
      if (options.author) {
        for (const alias of options.author.aliases) {
          nextEntry.authorAliases.add(alias);
        }
        nextEntry.authorConfidence = Math.max(nextEntry.authorConfidence, options.author.score);
      }
      if (options.institutionName) {
        nextEntry.institutionNames.add(options.institutionName);
      }
      if (options.topicTerm) {
        nextEntry.topicTerms.add(options.topicTerm);
      }
      collectedWorks.set(key, nextEntry);
    }
  }

  private finalizeItem(
    candidate: CollectedWork,
    authorName: string,
    topicVariants: string[]
  ): ScholarSearchItem {
    const signals: string[] = [];
    const matchedAuthorAliases = [...candidate.authorAliases].filter((alias) =>
      includesNormalized(candidate.record.authors.join(" "), alias)
    );
    if (matchedAuthorAliases.length) {
      signals.push(`author:${matchedAuthorAliases[0]}`);
    } else if (candidate.strategyNames.has("author_works")) {
      signals.push("author:openalex-author-id");
    }

    const matchedInstitutions = [...candidate.institutionNames].filter((institution) =>
      (candidate.record.institutions ?? []).some((value) => includesNormalized(value, institution))
    );
    if (matchedInstitutions.length) {
      signals.push(`institution:${matchedInstitutions[0]}`);
    }

    const matchedTopicTerms = uniqueList([
      ...[...candidate.topicTerms].filter((term) => matchesTopic(candidate.record, term)),
      ...topicVariants.filter((term) => matchesTopic(candidate.record, term))
    ]);
    if (matchedTopicTerms.length) {
      signals.push(`topic:${matchedTopicTerms[0]}`);
    }

    const matchScore =
      (candidate.strategyNames.has("institution_author") ? 14 : 0) +
      (candidate.strategyNames.has("author_works") && matchedInstitutions.length ? 8 : 0) +
      (candidate.strategyNames.has("institution_topic") ? 4 : 0) +
      matchedAuthorAliases.length * 8 +
      matchedInstitutions.length * 5 +
      matchedTopicTerms.length * 4 +
      Math.min(candidate.authorConfidence / 500, 8) +
      Math.min(candidate.record.citationCount ?? 0, 200) / 50 +
      scoreRecency(candidate.record.year) +
      scoreAuthorAliasMatch(authorName, matchedAuthorAliases);

    return {
      ...candidate.record,
      source: "openalex",
      matchScore,
      matchSignals: uniqueList(signals),
      matchedAuthorAliases: matchedAuthorAliases.length ? matchedAuthorAliases : undefined,
      matchedInstitutions: matchedInstitutions.length ? matchedInstitutions : undefined,
      matchedTopicTerms: matchedTopicTerms.length ? matchedTopicTerms : undefined,
      retrievalStrategies: [...candidate.strategyNames]
    };
  }

  private async getCachedJson<T>(
    cacheKey: string,
    factory: () => Promise<T>
  ): Promise<T> {
    const cached = await this.cache.get<T>(SCHOLAR_CACHE_NAMESPACE, cacheKey);
    if (cached) {
      return cached;
    }

    const value = await factory();
    await this.cache.set(
      SCHOLAR_CACHE_NAMESPACE,
      cacheKey,
      value,
      this.config.searchCacheTtlMs
    );
    return value;
  }
}

function buildTopicVariants(topic: string): string[] {
  if (!topic) {
    return [];
  }

  const variants = buildQueryVariants(topic, "keyword");
  const englishFirst = [
    ...variants.filter((variant) => containsLatin(variant)),
    ...variants.filter((variant) => !containsLatin(variant))
  ];
  return uniqueList(englishFirst).slice(0, TOPIC_VARIANT_LIMIT);
}

function buildOpenAlexInstitutionUrl(config: AppConfig, institution: string): string {
  const params = new URLSearchParams();
  params.set("search", institution);
  params.set("per-page", String(INSTITUTION_SEARCH_LIMIT));
  if (config.openAlexMailto) {
    params.set("mailto", config.openAlexMailto);
  }
  return `https://api.openalex.org/institutions?${params.toString()}`;
}

function buildOpenAlexAuthorUrl(
  config: AppConfig,
  authorName: string,
  filter?: string
): string {
  const params = new URLSearchParams();
  params.set("search", authorName);
  params.set("per-page", String(AUTHOR_CANDIDATE_LIMIT * 2));
  if (filter) {
    params.set("filter", filter);
  }
  if (config.openAlexMailto) {
    params.set("mailto", config.openAlexMailto);
  }
  return `https://api.openalex.org/authors?${params.toString()}`;
}

function buildOpenAlexWorksUrl(
  config: AppConfig,
  options: {
    filter: Array<string | undefined>;
    search?: string;
    perPage: number;
  }
): string {
  const params = new URLSearchParams();
  const filters = options.filter
    .map((value) => normalizeWhitespace(value))
    .filter(Boolean);
  if (filters.length) {
    params.set("filter", filters.join(","));
  }
  if (options.search) {
    params.set("search", options.search);
  }
  params.set("per-page", String(options.perPage));
  if (config.openAlexMailto) {
    params.set("mailto", config.openAlexMailto);
  }
  return `https://api.openalex.org/works?${params.toString()}`;
}

function upsertAuthorCandidate(
  collected: Map<string, ScholarAuthorCandidate>,
  candidate: ScholarAuthorCandidate
): void {
  const existing = collected.get(candidate.id);
  if (!existing) {
    collected.set(candidate.id, candidate);
    return;
  }

  collected.set(candidate.id, {
    ...existing,
    aliases: uniqueList([...existing.aliases, ...candidate.aliases]),
    institutions: uniqueList([...existing.institutions, ...candidate.institutions]),
    worksCount: Math.max(existing.worksCount ?? 0, candidate.worksCount ?? 0) || undefined,
    citedByCount:
      Math.max(existing.citedByCount ?? 0, candidate.citedByCount ?? 0) || undefined,
    score: Math.max(existing.score, candidate.score)
  });
}

function matchesTopic(record: ArticleRecord, topic: string): boolean {
  const normalized = normalizeWhitespace(topic);
  if (!normalized) {
    return false;
  }

  const haystacks = [
    record.title,
    record.abstract,
    ...(record.keywords ?? []),
    ...(record.subjects ?? [])
  ];
  return haystacks.some((value) => includesNormalized(value ?? "", normalized));
}

function includesNormalized(value: string, search: string): boolean {
  const left = normalizeWhitespace(value).toLowerCase();
  const right = normalizeWhitespace(search).toLowerCase();
  return Boolean(left && right && left.includes(right));
}

function scoreAuthorAliasMatch(authorName: string, aliases: string[]): number {
  const normalizedAuthor = normalizeWhitespace(authorName).toLowerCase();
  if (!normalizedAuthor) {
    return 0;
  }

  let score = 0;
  for (const alias of aliases) {
    const normalizedAlias = normalizeWhitespace(alias).toLowerCase();
    if (!normalizedAlias) {
      continue;
    }
    if (normalizedAlias === normalizedAuthor) {
      score = Math.max(score, 16);
      continue;
    }
    if (normalizedAlias.includes(normalizedAuthor) || normalizedAuthor.includes(normalizedAlias)) {
      score = Math.max(score, 10);
      continue;
    }
    if (shareFamilyGivenTokens(normalizedAuthor, normalizedAlias)) {
      score = Math.max(score, 7);
    }
  }
  return score;
}

function scoreExactTextMatch(input: string, candidate: string): number {
  const left = normalizeWhitespace(input).toLowerCase();
  const right = normalizeWhitespace(candidate).toLowerCase();
  if (!left || !right) {
    return 0;
  }
  if (left === right) {
    return 20;
  }
  if (right.includes(left) || left.includes(right)) {
    return 8;
  }
  return 0;
}

function scoreInstitutionAliasMatch(input: string, candidate: string): number {
  const left = normalizeWhitespace(input).toLowerCase();
  const right = normalizeWhitespace(candidate).toLowerCase();
  if (!left || !right) {
    return 0;
  }
  if (left.includes("中国石油大学") && right.includes("china university of petroleum")) {
    return 12;
  }
  if (left.includes("华东") && right.includes("east china")) {
    return 6;
  }
  if (left.includes("北京") && right.includes("beijing")) {
    return 6;
  }
  return 0;
}

function shareFamilyGivenTokens(left: string, right: string): boolean {
  const leftTokens = left.split(/[\s,.-]+/).filter(Boolean);
  const rightTokens = right.split(/[\s,.-]+/).filter(Boolean);
  if (!leftTokens.length || !rightTokens.length) {
    return false;
  }
  return leftTokens.some((token) => rightTokens.includes(token));
}

function containsLatin(value: string): boolean {
  return /[A-Za-z]/.test(value);
}

function selectAuthorAliasQueries(author: ScholarAuthorCandidate): string[] {
  const aliases = uniqueList(
    author.aliases.filter((alias) => containsLatin(alias)).map((alias) => normalizeWhitespace(alias))
  );
  if (aliases.length) {
    return aliases.slice(0, 2);
  }
  return [author.displayName];
}

function scoreRecency(year: number | undefined): number {
  if (!year) {
    return 0;
  }
  const now = new Date().getFullYear();
  if (year >= now - 1) {
    return 3;
  }
  if (year >= now - 3) {
    return 2;
  }
  if (year >= now - 6) {
    return 1;
  }
  return 0;
}

function compareScholarItems(left: ScholarSearchItem, right: ScholarSearchItem): number {
  return (
    right.matchScore - left.matchScore ||
    (right.year ?? 0) - (left.year ?? 0) ||
    (right.citationCount ?? 0) - (left.citationCount ?? 0) ||
    left.title.localeCompare(right.title)
  );
}

function isHighConfidenceScholarItem(item: ScholarSearchItem): boolean {
  return Boolean(
    item.matchedAuthorAliases?.length ||
      (item.retrievalStrategies.includes("author_works") &&
        item.matchedInstitutions?.length)
  );
}
