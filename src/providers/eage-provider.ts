import {
  MetadataLibraryProvider,
  type MetadataLibraryProviderOptions
} from "./library-metadata-provider.js";

const EAGE_OPTIONS: MetadataLibraryProviderOptions = {
  id: "eage",
  displayName: "EAGE EarthDoc",
  cacheNamespace: "search/eage",
  cacheVersion: 2,
  doiPrefixes: ["10.3997/"],
  publisherPattern: /(european association of geoscientists\s*&\s*engineers|eage)/i,
  journalPatterns: [/\beage\b/i, /earthdoc/i, /borehole geophysics workshop/i],
  urlPattern: /(earthdoc\.org|eage\.org)/i,
  keywordSearchHint: "EAGE",
  notes: [
    "EAGE search uses public metadata from Crossref and OpenAlex, centered on EarthDoc-indexed material.",
    "Coverage is strong for workshops, conference papers, and geoscience proceedings.",
    "Downloads prefer OA or repository links only."
  ]
};

export class EageProvider extends MetadataLibraryProvider {
  constructor() {
    super(EAGE_OPTIONS);
  }
}
