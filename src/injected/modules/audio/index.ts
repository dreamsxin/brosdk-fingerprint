import type { ExtensionStorage } from "../../../shared/config";
import { mulberry32, stableNoise } from "../../core/random";
import { record } from "../../core/record";
import { resolveAudioSeed } from "../../core/seed";
import { nativeProxy } from "../../core/stealth";
import { addAudioRisk, createAudioProfile, type AudioProfile } from "./profile";

const offlineProfiles = new WeakMap<OfflineAudioContext, AudioProfile>();
const bufferProfiles = new WeakMap<AudioBuffer, AudioProfile>();
const analyserProfiles = new WeakMap<AnalyserNode, AudioProfile>();
const compressorProfiles = new WeakMap<DynamicsCompressorNode, AudioProfile>();
const perturbedArrays = new WeakSet<Float32Array>();

const getOfflineProfile = (ctx: OfflineAudioContext): AudioProfile => {
  let profile = offlineProfiles.get(ctx);
  if (!profile) {
    profile = createAudioProfile();
    profile.hasOfflineContext = true;
    addAudioRisk(profile, 40);
    offlineProfiles.set(ctx, profile);
  }
  return profile;
};

const perturbFloatArray = (data: Float32Array, profile: AudioProfile, seed: number) => {
  if (perturbedArrays.has(data)) return;
  if (profile.riskScore <= 0 || data.length === 0) return;

  let hasSignal = false;
  for (let i = 0; i < data.length; i += Math.max(1, Math.floor(data.length / 64))) {
    if (Math.abs(data[i]) > 1e-9) {
      hasSignal = true;
      break;
    }
  }
  if (!hasSignal) return;

  const random = mulberry32(seed ^ profile.riskScore ^ data.length);
  const step = data.length > 4096 ? 97 : 23;
  for (let i = 0; i < data.length; i += step) {
    if (data[i] !== 0) {
      data[i] += (random() - 0.5) * 1e-7;
    }
  }
  perturbedArrays.add(data);
};

export const installAudio = (storage: ExtensionStorage) => {
  const config = storage.config.audio;
  if (!storage.config.enabled || !config.enabled) return;

  const seed = resolveAudioSeed(storage);
  if (!seed) return;

  if (typeof OfflineAudioContext !== "undefined") {
    const rawOfflineAudioContext = OfflineAudioContext;
    window.OfflineAudioContext = nativeProxy(rawOfflineAudioContext, {
      construct(target, args, newTarget) {
        const ctx = Reflect.construct(target, args, newTarget) as OfflineAudioContext;
        getOfflineProfile(ctx);
        record("audio.offlineContext", "high");
        return ctx;
      }
    }) as typeof OfflineAudioContext;

    const rawStartRendering = OfflineAudioContext.prototype.startRendering;
    OfflineAudioContext.prototype.startRendering = nativeProxy(rawStartRendering, {
      apply(target, thisArg: OfflineAudioContext, args) {
        const profile = getOfflineProfile(thisArg);
        profile.hasRendered = true;
        addAudioRisk(profile, 30);
        record("audio.startRendering", "high");
        const result = Reflect.apply(target, thisArg, args) as Promise<AudioBuffer> | void;
        if (result && typeof (result as Promise<AudioBuffer>).then === "function") {
          return (result as Promise<AudioBuffer>).then((buffer) => {
            bufferProfiles.set(buffer, profile);
            return buffer;
          });
        }
        return result;
      }
    }) as typeof OfflineAudioContext.prototype.startRendering;

    const rawCreateOscillator = OfflineAudioContext.prototype.createOscillator;
    OfflineAudioContext.prototype.createOscillator = nativeProxy(rawCreateOscillator, {
      apply(target, thisArg: OfflineAudioContext, args) {
        const profile = getOfflineProfile(thisArg);
        profile.hasOscillator = true;
        addAudioRisk(profile, 20);
        record("audio.oscillator", "high");
        return Reflect.apply(target, thisArg, args);
      }
    }) as typeof OfflineAudioContext.prototype.createOscillator;

    const rawCreateDynamicsCompressor = OfflineAudioContext.prototype.createDynamicsCompressor;
    OfflineAudioContext.prototype.createDynamicsCompressor = nativeProxy(rawCreateDynamicsCompressor, {
      apply(target, thisArg: OfflineAudioContext, args) {
        const profile = getOfflineProfile(thisArg);
        profile.hasCompressor = true;
        addAudioRisk(profile, 20);
        record("audio.compressor", "high");
        const node = Reflect.apply(target, thisArg, args) as DynamicsCompressorNode;
        compressorProfiles.set(node, profile);
        return node;
      }
    }) as typeof OfflineAudioContext.prototype.createDynamicsCompressor;

    const rawCreateAnalyser = OfflineAudioContext.prototype.createAnalyser;
    OfflineAudioContext.prototype.createAnalyser = nativeProxy(rawCreateAnalyser, {
      apply(target, thisArg: OfflineAudioContext, args) {
        const profile = getOfflineProfile(thisArg);
        profile.hasAnalyser = true;
        addAudioRisk(profile, 20);
        record("audio.analyser", "high");
        const node = Reflect.apply(target, thisArg, args) as AnalyserNode;
        analyserProfiles.set(node, profile);
        return node;
      }
    }) as typeof OfflineAudioContext.prototype.createAnalyser;
  }

  const rawGetChannelData = AudioBuffer.prototype.getChannelData;
  AudioBuffer.prototype.getChannelData = nativeProxy(rawGetChannelData, {
    apply(target, thisArg: AudioBuffer, args) {
      const data = Reflect.apply(target, thisArg, args) as Float32Array;
      const profile = bufferProfiles.get(thisArg);
      if (profile) {
        addAudioRisk(profile, 30);
        record("audio.getChannelData", profile.riskScore >= config.bufferNoiseScore ? "high" : "low");
        if (profile.riskScore >= config.bufferNoiseScore) {
          perturbFloatArray(data, profile, seed);
        }
      }
      return data;
    }
  }) as typeof AudioBuffer.prototype.getChannelData;

  const rawCopyFromChannel = AudioBuffer.prototype.copyFromChannel;
  AudioBuffer.prototype.copyFromChannel = nativeProxy(rawCopyFromChannel, {
    apply(target, thisArg: AudioBuffer, args: Parameters<AudioBuffer["copyFromChannel"]>) {
      const profile = bufferProfiles.get(thisArg);
      if (profile) {
        addAudioRisk(profile, 20);
        record("audio.copyFromChannel", profile.riskScore >= config.bufferNoiseScore ? "high" : "low");
        if (profile.riskScore >= config.bufferNoiseScore) {
          const data = rawGetChannelData.call(thisArg, args[1]);
          perturbFloatArray(data, profile, seed);
        }
      }
      return Reflect.apply(target, thisArg, args);
    }
  }) as typeof AudioBuffer.prototype.copyFromChannel;

  if (config.perturbCompressor && typeof DynamicsCompressorNode !== "undefined") {
    const descriptor = Object.getOwnPropertyDescriptor(DynamicsCompressorNode.prototype, "reduction");
    if (descriptor?.get) {
      Object.defineProperty(DynamicsCompressorNode.prototype, "reduction", {
        ...descriptor,
        get: nativeProxy(descriptor.get, {
          apply(target, thisArg, args) {
            const value = Reflect.apply(target, thisArg, args);
            const profile = compressorProfiles.get(thisArg as DynamicsCompressorNode);
            if (!profile) return value;
            addAudioRisk(profile, 10);
            record("audio.compressor.reduction", "low");
            return typeof value === "number" && value !== 0 && profile.riskScore >= 40
              ? value + stableNoise(seed, "compressor.reduction", 1e-7)
              : value;
          }
        })
      });
    }
  }

  if (config.perturbAnalyser && typeof AnalyserNode !== "undefined") {
    for (const key of ["getFloatFrequencyData", "getFloatTimeDomainData"] as const) {
      const raw = AnalyserNode.prototype[key];
      AnalyserNode.prototype[key] = nativeProxy(raw, {
        apply(target, thisArg, args: [Float32Array]) {
          const result = Reflect.apply(target, thisArg, args);
          const profile = analyserProfiles.get(thisArg as AnalyserNode);
          if (!profile) return result;
          addAudioRisk(profile, 20);
          record(`audio.analyser.${key}`, profile.riskScore >= config.bufferNoiseScore ? "high" : "low");
          const data = args[0];
          if (profile.riskScore >= config.bufferNoiseScore) {
            perturbFloatArray(data, profile, seed);
          }
          return result;
        }
      }) as typeof raw;
    }
  }
};
