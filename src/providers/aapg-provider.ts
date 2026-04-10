import {
  MetadataLibraryProvider,
  type MetadataLibraryProviderOptions
} from "./library-metadata-provider.js";

const AAPG_OPTIONS: MetadataLibraryProviderOptions = {
  id: "aapg",
  displayName: "AAPG",
  cacheNamespace: "search/aapg",
  cacheVersion: 3,
  publisherPattern: /(american association of petroleum geologists|aapg\/datapages|aapg)/i,
  excludePublisherPattern: /unmaintained records/i,
  journalPatterns: [/^aapg bulletin$/i, /search and discovery/i],
  urlPattern: /(datapages\.com|searchanddiscovery\.com|aapg\.org)/i,
  excludeUrlPattern: /deleted_DOI/i,
  keywordSearchHint: "AAPG",
  notes: [
    "AAPG search uses public metadata from Crossref and OpenAlex.",
    "Coverage emphasizes AAPG Bulletin and other AAPG or Datapages-indexed records exposed through DOI metadata.",
    "Downloads prefer OA or repository links only."
  ]
};

export class AapgProvider extends MetadataLibraryProvider {
  constructor() {
    super(AAPG_OPTIONS);
  }
}
