import {
  MetadataLibraryProvider,
  type MetadataLibraryProviderOptions
} from "./library-metadata-provider.js";

const JGE_OPTIONS: MetadataLibraryProviderOptions = {
  id: "jge",
  displayName: "Journal of Geophysics and Engineering",
  cacheNamespace: "search/jge",
  cacheVersion: 2,
  doiPrefixes: ["10.1093/jge/", "10.1088/1742-2132/", "10.1088/1742-2140/"],
  journalPatterns: [
    /^journal of geophysics and engineering$/i,
    /^j(?:ournal)?\.?\s*of\s*geophysics\s*and\s*engineering$/i
  ],
  urlPattern:
    /(academic\.oup\.com\/jge|iopscience\.iop\.org\/journal\/1742-2132|iopscience\.iop\.org\/journal\/1742-2140|iopscience\.iop\.org\/1742-2132|iopscience\.iop\.org\/1742-2140)/i,
  openAlexFilter: "primary_location.source.issn:1742-2140",
  keywordSearchHint: "Journal of Geophysics and Engineering",
  notes: [
    "JGE search uses public metadata from Crossref and OpenAlex.",
    "Coverage focuses on the Journal of Geophysics and Engineering across its historical IOP and current Oxford Academic records.",
    "Author and institution searches can use Crossref author-affiliation rescue when structured hints are provided.",
    "Downloads prefer OA or repository links only."
  ]
};

export class JgeProvider extends MetadataLibraryProvider {
  constructor() {
    super(JGE_OPTIONS);
  }
}
