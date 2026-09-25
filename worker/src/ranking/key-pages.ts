import { labelFromPath, pathDepth } from "../discovery/paths";
import type { Candidate, CandidateSource } from "../discovery/types";

export const POSITIVE_KEYWORDS = [
  "about",
  "services",
  "service",
  "work",
  "projects",
  "project",
  "portfolio",
  "pricing",
  "price",
  "plans",
  "team",
  "contact",
  "company",
  "product",
  "products",
  "features",
  "solutions",
  "customers",
  "gallery",
  "menu",
  "shop",
  "store",
  "blog",
  "insights",
  "resources",
  "docs",
  "faq",
] as const;

export const UTILITY_KEYWORDS = [
  "login",
  "log-in",
  "signin",
  "sign-in",
  "signup",
  "sign-up",
  "register",
  "account",
  "dashboard",
  "admin",
  "cart",
  "checkout",
  "payment",
  "billing",
  "privacy",
  "terms",
  "cookie",
  "legal",
  "search",
  "download",
  "wp-admin",
  "wp-login",
  "feed",
  "rss",
  "print",
  "tag",
  "tags",
  "author",
  "preview",
  "unsubscribe",
  "reset-password",
  "authentication",
  "password",
  "404",
] as const;

const ASSET_EXTENSIONS = [
  ".pdf",
  ".zip",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".ico",
  ".css",
  ".js",
  ".json",
  ".xml",
  ".txt",
  ".md",
  ".markdown",
  ".rss",
  ".atom",
  ".csv",
  ".map",
  ".mp4",
  ".webm",
  ".mov",
  ".avi",
  ".m4v",
  ".ogg",
  ".oga",
  ".mp3",
  ".wav",
  ".flac",
  ".m4a",
  ".glb",
  ".gltf",
  ".usdz",
  ".fbx",
  ".obj",
  ".stl",
  ".3ds",
  ".avif",
  ".apng",
  ".bmp",
  ".tiff",
  ".tif",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
];

const SOURCE_WEIGHT: Record<CandidateSource, number> = {
  sitemap: 30,
  header: 25,
  nav: 20,
  footer: 8,
  homepage: 10,
};

export interface RankedCandidate {
  url: string;
  path: string;
  label: string;
  sources: CandidateSource[];
  score: number;
  selected: boolean;
  status: "selected" | "excluded";
  priority: number | null;
  reason: string;
  selectedBecause: string;
  excludedReason: string | null;
  reasons: string[];
}

export interface SelectionReport {
  maxPages: number;
  pagesDiscovered: number;
  pagesSelected: number;
  candidates: RankedCandidate[];
}

export interface SelectionInput {
  candidates: Candidate[];
  maxPages: number;
  homepageUrl: string;
  homepageLabel?: string;
}

function bestSourceWeight(sources: CandidateSource[]): { weight: number; source: CandidateSource } {
  let best: CandidateSource = "homepage";
  let weight = 0;

  for (const source of sources) {
    const candidateWeight = SOURCE_WEIGHT[source];
    if (candidateWeight > weight) {
      weight = candidateWeight;
      best = source;
    }
  }

  return { weight, source: best };
}

export function buildSelection(input: SelectionInput): SelectionReport {
  const { candidates, maxPages, homepageUrl } = input;
  const ranked: RankedCandidate[] = [];

  const homepage: RankedCandidate = {
    url: homepageUrl,
    path: "/",
    label: input.homepageLabel ?? "Homepage",
    sources: ["homepage"],
    score: 1_000,
    selected: true,
    status: "selected",
    priority: 1,
    reason: "Always analyzed: the requested homepage.",
    selectedBecause: "Always analyzed: the requested homepage.",
    excludedReason: null,
    reasons: ["Homepage is always included."],
  };

  for (const candidate of candidates) {
    const haystack = `${candidate.label} ${candidate.path}`.toLowerCase();
    const reasons: string[] = [];
    const segments = candidate.path.split("/").filter(Boolean);
    const lastSegment = segments[segments.length - 1] ?? "";
    const dot = lastSegment.lastIndexOf(".");
    const extension = dot > 0 ? lastSegment.slice(dot).toLowerCase() : "";

    if (ASSET_EXTENSIONS.includes(extension)) {
      const excludedReason = `Excluded: non-HTML asset (${extension}).`;
      ranked.push({
        url: candidate.url,
        path: candidate.path,
        label: candidate.label,
        sources: candidate.sources,
        score: 0,
        selected: false,
        status: "excluded",
        priority: null,
        reason: excludedReason,
        selectedBecause: "",
        excludedReason,
        reasons,
      });
      continue;
    }

    const utility = UTILITY_KEYWORDS.find((keyword) => haystack.includes(keyword));
    if (utility) {
      const excludedReason = `Excluded: matches utility keyword "${utility}".`;
      ranked.push({
        url: candidate.url,
        path: candidate.path,
        label: candidate.label,
        sources: candidate.sources,
        score: 0,
        selected: false,
        status: "excluded",
        priority: null,
        reason: excludedReason,
        selectedBecause: "",
        excludedReason,
        reasons,
      });
      continue;
    }

    const { weight, source } = bestSourceWeight(candidate.sources);
    let score = weight;
    reasons.push(`Discovered via ${source} (weight ${weight}).`);

    if (candidate.occurrences > 1) {
      const bonus = Math.min(candidate.occurrences - 1, 4) * 5;
      score += bonus;
      reasons.push(`Repeated ${candidate.occurrences} times across navigation areas (+${bonus}).`);
    }

    const matched = POSITIVE_KEYWORDS.filter((keyword) => haystack.includes(keyword));
    if (matched.length > 0) {
      const bonus = Math.min(matched.length, 2) * 20;
      score += bonus;
      reasons.push(`Matches priority keyword "${matched[0]}" (+${bonus}).`);
    }

    const depth = pathDepth(candidate.path);
    if (depth === 1) {
      score += 10;
      reasons.push("Top-level path (+10).");
    } else if (depth === 2) {
      score += 6;
      reasons.push("Shallow path (+6).");
    } else if (depth === 3) {
      score += 2;
    } else if (depth > 3) {
      score -= 8;
      reasons.push("Deep detail path (-8).");
    }

    if (candidate.hasQuery) {
      score -= 15;
      reasons.push("Query-heavy URL (-15).");
    }

    ranked.push({
      url: candidate.url,
      path: candidate.path,
      label: candidate.label || labelFromPath(candidate.path),
      sources: candidate.sources,
      score: Math.max(score, 1),
      selected: false,
      status: "excluded",
      priority: null,
      reason: "",
      selectedBecause: reasons.join(" "),
      excludedReason: null,
      reasons,
    });
  }

  const ordered = ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.path.length !== b.path.length) return a.path.length - b.path.length;
    return a.path.localeCompare(b.path);
  });

  let slots = Math.max(maxPages - 1, 0);
  let priority = 2;
  // Representative sampling: deep pages that share a top-level section usually
  // share one template (case studies, blog posts, docs). Selecting one per
  // section teaches the layout with a fraction of the browser-minutes; the
  // rest are excluded with the representative named. Top-level pages are
  // always distinct and never sampled away.
  const sectionRep = new Map<string, { path: string; priority: number }>();
  for (const candidate of ordered) {
    const segments = candidate.path.split("/").filter(Boolean);
    if (slots <= 0 || candidate.excludedReason !== null) {
      if (!candidate.selected) {
        candidate.status = "excluded";
        if (!candidate.excludedReason) {
          candidate.excludedReason = `Excluded: ranked below the top ${maxPages} threshold (score ${candidate.score}).`;
        }
        candidate.reason = candidate.excludedReason;
      }
      continue;
    }
    if (segments.length >= 2) {
      const section = segments[0] as string;
      const rep = sectionRep.get(section);
      if (rep) {
        candidate.selected = false;
        candidate.status = "excluded";
        candidate.priority = null;
        candidate.excludedReason =
          `Excluded: section /${section}/ is already represented by ${rep.path} ` +
          `(priority ${rep.priority}); deep pages in one section share a template.`;
        candidate.reason = candidate.excludedReason;
        continue;
      }
    }
    candidate.selected = true;
    candidate.status = "selected";
    candidate.priority = priority;
    candidate.selectedBecause = `Selected (priority ${candidate.priority}). ${candidate.selectedBecause}`;
    candidate.reason = candidate.selectedBecause;
    if (segments.length >= 2) {
      sectionRep.set(segments[0] as string, { path: candidate.path, priority });
    }
    priority += 1;
    slots -= 1;
  }

  const all = [homepage, ...ordered];

  return {
    maxPages,
    pagesDiscovered: all.length,
    pagesSelected: all.filter((candidate) => candidate.selected).length,
    candidates: all,
  };
}
