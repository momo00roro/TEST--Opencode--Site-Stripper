export type CandidateSource = "sitemap" | "header" | "nav" | "footer" | "homepage";

export interface Candidate {
  url: string;
  path: string;
  label: string;
  sources: CandidateSource[];
  inNav: boolean;
  occurrences: number;
  hasQuery: boolean;
}

export interface DiscoveryResult {
  candidates: Candidate[];
  sitemapsChecked: string[];
  sitemapUrlCount: number;
  robotsFound: boolean;
  warnings: string[];
}
