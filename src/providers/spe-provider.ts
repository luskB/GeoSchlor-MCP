import {
  MetadataLibraryProvider,
  type MetadataLibraryProviderOptions
} from "./library-metadata-provider.js";

const SPE_OPTIONS: MetadataLibraryProviderOptions = {
  id: "spe",
  displayName: "SPE",
  cacheNamespace: "search/spe",
  cacheVersion: 2,
  doiPrefixes: ["10.2118/", "10.2523/", "10.15530/"],
  publisherPattern: /(society of petroleum engineers|^spe$)/i,
  journalPatterns: [/society of petroleum engineers/i, /\bspe\b/i],
  urlPattern: /(onepetro\.org|spe\.org\/elibrary)/i,
  keywordSearchHint: "SPE",
  notes: [
    "SPE search uses public metadata from Crossref and OpenAlex.",
    "Coverage emphasizes SPE journals, conference papers, and other SPE-indexed records exposed through DOI metadata.",
    "Downloads prefer OA or repository links only."
  ]
};

export class SpeProvider extends MetadataLibraryProvider {
  constructor() {
    super(SPE_OPTIONS);
  }
}
