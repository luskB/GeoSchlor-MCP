import { SearchMode, SourceId } from "../types.js";
import { normalizeWhitespace, uniqueList } from "./text.js";

interface QueryPair {
  zh: string;
  en: string[];
}

const DOMAIN_QUERY_PAIRS: QueryPair[] = [
  { zh: "随钻测井", en: ["logging while drilling", "lwd"] },
  { zh: "成像测井", en: ["image logging"] },
  { zh: "声波测井", en: ["sonic logging"] },
  { zh: "电成像测井", en: ["electrical imaging logging", "image logging"] },
  { zh: "核磁共振测井", en: ["nmr logging"] },
  { zh: "地球物理勘探", en: ["geophysical exploration"] },
  { zh: "物探", en: ["geophysical exploration", "geophysics"] },
  { zh: "测井", en: ["well logging", "logging"] },
  { zh: "测井解释", en: ["log interpretation"] },
  { zh: "岩石物理", en: ["rock physics"] },
  { zh: "储层", en: ["reservoir"] },
  { zh: "孔隙度", en: ["porosity"] },
  { zh: "渗透率", en: ["permeability"] },
  { zh: "地震", en: ["seismic"] },
  { zh: "地球物理", en: ["geophysics"] },
  { zh: "地质", en: ["geology"] },
  { zh: "页岩气", en: ["shale gas"] },
  { zh: "非常规油气", en: ["unconventional oil and gas"] }
];

const CHINESE_PRIORITY_SOURCES = new Set<SourceId>(["cnki", "wanfang", "vip"]);
const ENGLISH_PRIORITY_SOURCES = new Set<SourceId>([
  "geophysics",
  "petrophysics",
  "onepetro"
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

  const exactCompanions = collectExactCompanions(normalized);
  variants.push(...exactCompanions);

  return uniqueList(variants).slice(0, 3);
}

export function prioritizeQueryVariants(source: SourceId, variants: string[]): string[] {
  if (variants.length <= 1) {
    return variants;
  }

  const preferred = [...variants];
  preferred.sort((left, right) => scoreVariant(source, right) - scoreVariant(source, left));
  return uniqueList(preferred);
}

function scoreVariant(source: SourceId, query: string): number {
  const chinese = containsChinese(query);
  const english = containsLatin(query);

  if (CHINESE_PRIORITY_SOURCES.has(source)) {
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
    for (const english of pair.en.sort((left, right) => right.length - left.length)) {
      const pattern = new RegExp(escapeForRegExp(english), "gi");
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
    if (normalized === pair.zh) {
      return pair.en.slice(1);
    }
    if (pair.en.some((english) => english.toLowerCase() === normalized)) {
      return [pair.zh];
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
