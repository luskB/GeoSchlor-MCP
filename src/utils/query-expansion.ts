import { SearchMode, SourceId } from "../types.js";
import { normalizeWhitespace, uniqueList } from "./text.js";

interface QueryPair {
  zh: string;
  en: string[];
}

const DOMAIN_QUERY_PAIRS: QueryPair[] = [
  { zh: "\u968f\u94bb\u6d4b\u4e95", en: ["logging while drilling", "lwd"] },
  { zh: "\u6210\u50cf\u6d4b\u4e95", en: ["image logging"] },
  { zh: "\u58f0\u6ce2\u6d4b\u4e95", en: ["sonic logging", "acoustic logging"] },
  {
    zh: "\u7535\u6210\u50cf\u6d4b\u4e95",
    en: ["electrical imaging logging", "image logging"]
  },
  { zh: "\u6838\u78c1\u5171\u632f\u6d4b\u4e95", en: ["nmr logging"] },
  { zh: "\u5730\u7403\u7269\u7406\u52d8\u63a2", en: ["geophysical exploration"] },
  { zh: "\u7269\u63a2", en: ["geophysical exploration", "geophysics"] },
  { zh: "\u6d4b\u4e95", en: ["well logging", "logging"] },
  { zh: "\u6d4b\u4e95\u89e3\u91ca", en: ["log interpretation"] },
  { zh: "\u5ca9\u77f3\u7269\u7406", en: ["rock physics"] },
  { zh: "\u50a8\u5c42", en: ["reservoir"] },
  { zh: "\u5b54\u9699\u5ea6", en: ["porosity"] },
  { zh: "\u6e17\u900f\u7387", en: ["permeability"] },
  { zh: "\u5730\u9707", en: ["seismic"] },
  { zh: "\u5730\u7403\u7269\u7406", en: ["geophysics"] },
  { zh: "\u5730\u8d28", en: ["geology"] },
  { zh: "\u9875\u5ca9\u6c14", en: ["shale gas"] },
  { zh: "\u975e\u5e38\u89c4\u6cb9\u6c14", en: ["unconventional oil and gas"] }
];

const CHINESE_PRIORITY_SOURCES = new Set<SourceId>(["cnki", "wanfang", "vip"]);
const ENGLISH_PRIORITY_SOURCES = new Set<SourceId>([
  "geophysics",
  "jge",
  "petrophysics",
  "onepetro",
  "spe",
  "spwla",
  "eage",
  "aapg"
]);

export function buildQueryVariants(query: string, mode: SearchMode): string[] {
  const normalized = normalizeWhitespace(query);
  if (!normalized) {
    return [];
  }

  if (mode === "author" || mode === "doi" || mode === "journal") {
    return [normalized];
  }

  const variants = [normalized];
  const zhToEn = translateZhToEn(normalized);
  if (zhToEn) {
    variants.push(zhToEn);
  }

  const enToZh = translateEnToZh(normalized);
  if (enToZh) {
    variants.push(enToZh);
  }

  variants.push(...collectExactCompanions(normalized));

  return uniqueList(variants).slice(0, 4);
}

export function prioritizeQueryVariants(source: SourceId, variants: string[]): string[] {
  const uniqueVariants = uniqueList(variants.map((variant) => normalizeWhitespace(variant)).filter(Boolean));
  if (uniqueVariants.length <= 1) {
    return uniqueVariants;
  }

  const [original, ...companions] = uniqueVariants;
  companions.sort(
    (left, right) => scoreVariant(source, original, right) - scoreVariant(source, original, left)
  );
  return [original, ...companions];
}

function scoreVariant(source: SourceId, originalQuery: string, query: string): number {
  const chinese = containsChinese(query);
  const english = containsLatin(query);
  const originalIsEnglish = containsLatin(originalQuery) && !containsChinese(originalQuery);
  const originalIsChinese = containsChinese(originalQuery) && !containsLatin(originalQuery);

  if (CHINESE_PRIORITY_SOURCES.has(source)) {
    if (originalIsEnglish) {
      return english ? 3 : chinese ? 2 : 1;
    }
    if (originalIsChinese) {
      return chinese ? 3 : english ? 1 : 2;
    }
    return chinese ? 3 : english ? 1 : 2;
  }

  if (ENGLISH_PRIORITY_SOURCES.has(source)) {
    return english ? 3 : chinese ? 1 : 2;
  }

  return chinese === english ? 2 : chinese ? 3 : 2;
}

function translateZhToEn(query: string): string | undefined {
  if (!containsChinese(query)) {
    return undefined;
  }

  let translated = query;
  let matched = false;
  for (const pair of [...DOMAIN_QUERY_PAIRS].sort((left, right) => right.zh.length - left.zh.length)) {
    if (translated.includes(pair.zh)) {
      translated = translated.split(pair.zh).join(pair.en[0]);
      matched = true;
    }
  }

  return matched ? normalizeWhitespace(translated) : undefined;
}

function translateEnToZh(query: string): string | undefined {
  if (!containsLatin(query)) {
    return undefined;
  }

  let translated = query;
  let matched = false;
  for (const pair of DOMAIN_QUERY_PAIRS) {
    const englishVariants = [...pair.en].sort((left, right) => right.length - left.length);
    for (const english of englishVariants) {
      const pattern = new RegExp(`\\b${escapeForRegExp(english)}\\b`, "gi");
      if (pattern.test(translated)) {
        translated = translated.replace(pattern, pair.zh);
        matched = true;
      }
    }
  }

  return matched ? normalizeWhitespace(translated) : undefined;
}

function collectExactCompanions(query: string): string[] {
  const normalized = normalizeWhitespace(query).toLowerCase();
  for (const pair of DOMAIN_QUERY_PAIRS) {
    if (normalized === pair.zh.toLowerCase()) {
      return [...pair.en];
    }

    const englishIndex = pair.en.findIndex((english) => english.toLowerCase() === normalized);
    if (englishIndex >= 0) {
      return [
        ...pair.en.filter((_, index) => index !== englishIndex),
        pair.zh
      ];
    }
  }

  return [];
}

function containsChinese(value: string): boolean {
  return /[\u4e00-\u9fff]/.test(value);
}

function containsLatin(value: string): boolean {
  return /[A-Za-z]/.test(value);
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
