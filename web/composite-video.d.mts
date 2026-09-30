export interface CompositeDest {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CompositePlan {
  sectionIndex: number;
  videoIndex: number;
  dest: CompositeDest;
}

export interface CompositeStats {
  composited: number;
  skipped: Array<{ section: number; video: number; reason: string }>;
  total: number;
  cached?: boolean;
  unavailable?: boolean;
}

export function planComposites(page: Record<string, any>): CompositePlan[];

export function coverRect(
  srcW: number,
  srcH: number,
  dst: { w: number; h: number },
): { sx: number; sy: number; sw: number; sh: number } | null;

export function compositeSectionStills(analysis: Record<string, any>, deps?: Record<string, any>): Promise<CompositeStats>;
