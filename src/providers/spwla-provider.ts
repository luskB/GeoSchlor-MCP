import {
  MetadataLibraryProvider,
  type MetadataLibraryProviderOptions
} from "./library-metadata-provider.js";

const SPWLA_OPTIONS: MetadataLibraryProviderOptions = {
  id: "spwla",
  displayName: "SPWLA",
  cacheNamespace: "search/spwla",
  cacheVersion: 2,
  doiPrefixes: ["10.30632/"],
  publisherPattern: /(society of petrophysicists and well log analysts|spwla)/i,
  journalPatterns: [/^petrophysics\b/i, /\bspwla\b/i, /logging symposium/i],
  urlPattern: /(spwla\.org|onepetro\.org)/i,
  keywordSearchHint: "SPWLA",
  notes: [
    "SPWLA search uses public metadata from Crossref and OpenAlex.",
    "Coverage extends beyond the Petrophysics journal to SPWLA transactions and symposium-style records when metadata is publicly indexed.",
    "Downloads prefer OA or repository links only."
  ]
};

export class SpwlaProvider extends MetadataLibraryProvider {
  constructor() {
    super(SPWLA_OPTIONS);
  }
}
