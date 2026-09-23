/**
 * AI Audio De-Noiser Type Definitions
 */

export type MonitoringMode = 'denoised' | 'original' | 'highs-clean' | 'delta';

export type VisualizerTab = 'rms' | '2d';

export type SmoothingLevel = 'low' | 'med' | 'high';

export interface DenoiseParams {
  amountDb: number;
  cutoffHz: number;
  trackingSec: number;
  transientSens: number;
  alpha: number;
  smoothing: SmoothingLevel;
}

export interface TimelineData {
  times: Float32Array;
  rmsOrig: Float32Array;
  noiseOrig: Float32Array;
  noiseClean: Float32Array | null;
}

export interface Map2DData {
  offscreenCanvas: HTMLCanvasElement;
  attacks: Float32Array;
  duration: number;
  cutoffHz: number;
  amountDb: number;
  sampleRate: number;
}

export interface STFTChannelCache {
  mags: Float32Array[];
  phases: Float32Array[];
  fluxes: Float32Array;
  p90Flux: number;
}

export interface DenoiseResult {
  denoisedBuffer: AudioBuffer;
  deltaBuffer: AudioBuffer;
  highsCleanBuffer: AudioBuffer;
  map2DData: Map2DData;
  noiseClean: Float32Array;
}

export interface ExportOptions {
  targetMode: 'denoised' | 'highs-clean' | 'delta';
  bitDepth: 16 | 24 | 32;
  targetSampleRate: 'source' | number;
}
