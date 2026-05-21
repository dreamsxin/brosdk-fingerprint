export type AudioProfile = {
  riskScore: number;
  hasOfflineContext: boolean;
  hasOscillator: boolean;
  hasCompressor: boolean;
  hasAnalyser: boolean;
  hasRendered: boolean;
};

export const createAudioProfile = (): AudioProfile => ({
  riskScore: 0,
  hasOfflineContext: false,
  hasOscillator: false,
  hasCompressor: false,
  hasAnalyser: false,
  hasRendered: false
});

export const addAudioRisk = (profile: AudioProfile, score: number) => {
  profile.riskScore += score;
};

