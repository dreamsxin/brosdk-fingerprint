import { mulberry32, stableNoise } from "../../core/random";
import type { Canvas2DProfile } from "./profile";

export const perturbNumber = (value: number, seed: number, salt: string, scale = 0.018): number => {
  if (!Number.isFinite(value)) return value;
  return value + stableNoise(seed, salt, scale);
};

export const perturbImageData = (imageData: ImageData, profile: Canvas2DProfile, seed: number): ImageData => {
  const data = imageData.data;
  if (!data.length || profile.riskScore <= 0) return imageData;

  const random = mulberry32(seed ^ profile.riskScore ^ imageData.width ^ imageData.height);
  const stride = profile.riskScore >= 100 ? 47 : 89;

  for (let i = 0; i < data.length; i += 4 * stride) {
    const alpha = data[i + 3];
    if (alpha === 0) continue;
    const delta = random() > 0.5 ? 1 : -1;
    const channel = i + Math.floor(random() * 3);
    data[channel] = Math.max(0, Math.min(255, data[channel] + delta));
  }

  return imageData;
};
