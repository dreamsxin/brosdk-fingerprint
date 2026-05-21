export type WebGLProfile = {
  riskScore: number;
  riskKeys: Set<string>;
};

export const createWebGLProfile = (): WebGLProfile => ({
  riskScore: 0,
  riskKeys: new Set()
});

export const addWebGLRisk = (profile: WebGLProfile, score: number, key: string) => {
  if (profile.riskKeys.has(key)) return;
  profile.riskKeys.add(key);
  profile.riskScore = Math.min(240, profile.riskScore + score);
};

