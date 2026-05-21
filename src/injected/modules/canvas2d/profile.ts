export type RiskRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
  reason: string;
};

export type PathState = {
  current?: { x: number; y: number };
  hasCurve: boolean;
  hasNonAxisLine: boolean;
  hasAxisAlignedOnly: boolean;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type Canvas2DProfile = {
  riskScore: number;
  riskKeys: Set<string>;
  hasText: boolean;
  hasGradient: boolean;
  hasPattern: boolean;
  hasCurve: boolean;
  hasImage: boolean;
  hasTransform: boolean;
  hasShadow: boolean;
  hasComposite: boolean;
  hasAntialiasShape: boolean;
  hasOnlySolidFill: boolean;
  hasOnlyAxisAlignedLines: boolean;
  regions: RiskRegion[];
  path: PathState;
};

export const createPathState = (): PathState => ({
  hasCurve: false,
  hasNonAxisLine: false,
  hasAxisAlignedOnly: true,
  minX: Number.POSITIVE_INFINITY,
  minY: Number.POSITIVE_INFINITY,
  maxX: Number.NEGATIVE_INFINITY,
  maxY: Number.NEGATIVE_INFINITY
});

export const createProfile = (): Canvas2DProfile => ({
  riskScore: 0,
  riskKeys: new Set(),
  hasText: false,
  hasGradient: false,
  hasPattern: false,
  hasCurve: false,
  hasImage: false,
  hasTransform: false,
  hasShadow: false,
  hasComposite: false,
  hasAntialiasShape: false,
  hasOnlySolidFill: true,
  hasOnlyAxisAlignedLines: true,
  regions: [],
  path: createPathState()
});

export const addPoint = (path: PathState, x: number, y: number) => {
  path.minX = Math.min(path.minX, x);
  path.minY = Math.min(path.minY, y);
  path.maxX = Math.max(path.maxX, x);
  path.maxY = Math.max(path.maxY, y);
};

export const addRegion = (profile: Canvas2DProfile, region: RiskRegion) => {
  if (!Number.isFinite(region.x) || !Number.isFinite(region.y)) return;
  if (region.width <= 0 || region.height <= 0) return;
  profile.regions.push(region);
};

export const addRisk = (profile: Canvas2DProfile, score: number, key?: string) => {
  if (key) {
    if (profile.riskKeys.has(key)) return;
    profile.riskKeys.add(key);
  }
  profile.riskScore = Math.min(240, profile.riskScore + score);
};

export const riskSignature = (profile: Canvas2DProfile): string => {
  return [...profile.riskKeys].sort().join("|");
};
