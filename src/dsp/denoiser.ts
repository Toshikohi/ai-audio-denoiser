/**
 * STFT Adaptive Wiener Filtering & Spectral Denoising Engine
 * Direct frequency-isolated Highs Clean extraction & 2D Map generation
 */

import { FastRadix2FFT } from './fft';
import type { DenoiseParams, DenoiseResult, Map2DData, STFTChannelCache, TimelineData } from '../types';

/**
 * Pre-computes timeline RMS and high-frequency noise floor curves
 */
export function computeTimelineAnalysis(buffer: AudioBuffer): TimelineData {
  const sr = buffer.sampleRate;
  const chL = buffer.getChannelData(0);
  const chR = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : chL;
  const len = buffer.length;
  const winSize = 2048;
  const hop = 2048; // ~42ms resolution for timeline display
  const numSlices = Math.floor(len / hop);

  const times = new Float32Array(numSlices);
  const rmsOrig = new Float32Array(numSlices);
  const noiseOrig = new Float32Array(numSlices);

  // Simple HF noise estimator (zero crossing & 6k+ energy proxy)
  for (let i = 0; i < numSlices; i++) {
    const start = i * hop;
    let sumSq = 0;
    let diffSq = 0;
    for (let j = 0; j < winSize && (start + j) < len; j++) {
      const s = (chL[start + j] + chR[start + j]) * 0.5;
      sumSq += s * s;
      if (j > 0) {
        const prev = (chL[start + j - 1] + chR[start + j - 1]) * 0.5;
        const d = s - prev;
        diffSq += d * d;
      }
    }
    times[i] = (start + winSize / 2) / sr;
    const rms = Math.sqrt(sumSq / winSize);
    const hfProxy = Math.sqrt(diffSq / winSize);

    rmsOrig[i] = Math.max(-80, 20 * Math.log10(rms + 1e-9));
    noiseOrig[i] = Math.max(-80, 20 * Math.log10(hfProxy + 1e-9));
  }

  return {
    times,
    rmsOrig,
    noiseOrig,
    noiseClean: null
  };
}

export interface DenoiseExecutionOptions {
  audioCtx: AudioContext;
  srcBuffer: AudioBuffer;
  params: DenoiseParams;
  cachedSTFT: STFTChannelCache[] | null;
  fftSize?: number;
  hopSize?: number;
  onProgress?: (pct: number, status: string) => Promise<void> | void;
}

/**
 * Main adaptive STFT denoising algorithm
 */
export async function runDenoiseCore(
  options: DenoiseExecutionOptions
): Promise<{ result: DenoiseResult; stftCache: STFTChannelCache[] }> {
  const {
    audioCtx,
    srcBuffer,
    params,
    cachedSTFT,
    fftSize = 2048,
    hopSize = 512,
    onProgress
  } = options;

  const sr = srcBuffer.sampleRate;
  const numChannels = srcBuffer.numberOfChannels;
  const totalSamples = srcBuffer.length;
  const nFft = fftSize;
  const hop = hopSize;
  const numFrames = Math.floor((totalSamples - nFft) / hop) + 1;
  const fftEngine = new FastRadix2FFT(nFft);

  const freqs = new Float32Array(nFft / 2 + 1);
  for (let i = 0; i <= nFft / 2; i++) {
    freqs[i] = (i * sr) / nFft;
  }

  const fCutoff = params.cutoffHz;
  const fLow = fCutoff * 0.8;
  const freqWeight = new Float32Array(nFft / 2 + 1);
  for (let i = 0; i <= nFft / 2; i++) {
    if (freqs[i] <= fLow) {
      freqWeight[i] = 0;
    } else if (freqs[i] >= fCutoff) {
      freqWeight[i] = 1.0;
    } else {
      freqWeight[i] = (freqs[i] - fLow) / (fCutoff - fLow);
    }
  }

  const minGainLin = Math.pow(10, -params.amountDb / 20.0);
  const rollFrames = Math.max(5, Math.floor(params.trackingSec * sr / hop));
  const alpha = params.alpha;
  const transientSens = params.transientSens;

  // 1. Forward STFT (compute or reuse cache)
  let stftCache: STFTChannelCache[] = cachedSTFT || [];
  if (!cachedSTFT || cachedSTFT.length !== numChannels) {
    stftCache = [];
    const timeFrame = new Float32Array(nFft);
    const specReal = new Float32Array(nFft / 2 + 1);
    const specImag = new Float32Array(nFft / 2 + 1);

    for (let ch = 0; ch < numChannels; ch++) {
      const inputData = srcBuffer.getChannelData(ch);
      const mags: Float32Array[] = new Array(numFrames);
      const phases: Float32Array[] = new Array(numFrames);
      const fluxes = new Float32Array(numFrames);

      for (let i = 0; i < numFrames; i++) {
        const start = i * hop;
        for (let j = 0; j < nFft; j++) {
          timeFrame[j] = inputData[start + j];
        }
        fftEngine.fft(timeFrame, specReal, specImag);

        const m = new Float32Array(nFft / 2 + 1);
        const p = new Float32Array(nFft / 2 + 1);
        for (let k = 0; k <= nFft / 2; k++) {
          const r = specReal[k];
          const im = specImag[k];
          m[k] = Math.sqrt(r * r + im * im);
          p[k] = Math.atan2(im, r);
        }
        mags[i] = m;
        phases[i] = p;

        if (i > 0) {
          let fDiff = 0;
          const prevM = mags[i - 1];
          for (let k = 0; k <= nFft / 2; k++) {
            if (freqs[k] >= 1000 && freqs[k] <= 8000) {
              const d = m[k] - prevM[k];
              if (d > 0) fDiff += d;
            }
          }
          fluxes[i] = fDiff;
        }

        if (i % 150 === 0 && onProgress) {
          const pct = Math.round(((ch * numFrames + i) / (numChannels * numFrames * 2)) * 100);
          await onProgress(pct, `Analyzing acoustics (${ch + 1}/${numChannels}ch)...`);
          await new Promise(r => setTimeout(r, 0));
        }
      }

      const sortedFlux = Float32Array.from(fluxes).sort();
      const p90Flux = sortedFlux[Math.floor(numFrames * 0.9)] + 1e-7;

      stftCache.push({ mags, phases, fluxes, p90Flux });
    }
  }

  // 2. Compute Noise Floor, Gains & ISTFT
  const denoisedChannels: Float32Array[] = [];
  const deltaChannels: Float32Array[] = [];
  const highsCleanChannels: Float32Array[] = [];
  const specReal = new Float32Array(nFft / 2 + 1);
  const specImag = new Float32Array(nFft / 2 + 1);
  const synthFrame = new Float32Array(nFft);
  const specRealHigh = new Float32Array(nFft / 2 + 1);
  const specImagHigh = new Float32Array(nFft / 2 + 1);
  const synthFrameHigh = new Float32Array(nFft);

  let map2DData: Map2DData | null = null;

  for (let ch = 0; ch < numChannels; ch++) {
    const inputData = srcBuffer.getChannelData(ch);
    const outClean = new Float32Array(totalSamples);
    const outHighsClean = new Float32Array(totalSamples);
    const winSum = new Float32Array(totalSamples);
    const { mags, phases, fluxes, p90Flux } = stftCache[ch];

    if (onProgress) {
      const basePct = 20 + Math.round((ch / numChannels) * 15);
      await onProgress(basePct, `Estimating noise floor (${ch + 1}/${numChannels}ch)...`);
      await new Promise(r => setTimeout(r, 0));
    }

    // Compute Anchors
    const stepEval = Math.max(1, Math.floor(rollFrames / 4));
    const anchors: number[] = [];
    for (let a = 0; a < numFrames; a += stepEval) {
      anchors.push(a);
    }
    if (anchors[anchors.length - 1] !== numFrames - 1) {
      anchors.push(numFrames - 1);
    }

    const anchorNoise: Float32Array[] = [];
    for (const aIdx of anchors) {
      const wStart = Math.max(0, aIdx - Math.floor(rollFrames / 2));
      const wEnd = Math.min(numFrames, aIdx + Math.floor(rollFrames / 2) + 1);
      const wCount = wEnd - wStart;
      const nProfile = new Float32Array(nFft / 2 + 1);

      const tempVals = new Float32Array(wCount);
      for (let k = 0; k <= nFft / 2; k++) {
        if (freqWeight[k] === 0) continue;
        for (let w = 0; w < wCount; w++) {
          tempVals[w] = mags[wStart + w][k];
        }
        tempVals.sort();
        nProfile[k] = tempVals[Math.floor(wCount * 0.15)];
      }
      anchorNoise.push(nProfile);
    }

    if (onProgress) {
      const gainPct = 35 + Math.round((ch / numChannels) * 15);
      await onProgress(gainPct, `Applying spectral gain (${ch + 1}/${numChannels}ch)...`);
      await new Promise(r => setTimeout(r, 0));
    }

    // Gains
    const gains: Float32Array[] = new Array(numFrames);
    let currentAnchorIdx = 0;

    for (let i = 0; i < numFrames; i++) {
      while (currentAnchorIdx < anchors.length - 1 && anchors[currentAnchorIdx + 1] <= i) {
        currentAnchorIdx++;
      }
      const a0 = anchors[currentAnchorIdx];
      const a1 = anchors[Math.min(anchors.length - 1, currentAnchorIdx + 1)];
      const ratio = (a1 === a0) ? 0 : (i - a0) / (a1 - a0);
      const n0 = anchorNoise[currentAnchorIdx];
      const n1 = anchorNoise[Math.min(anchors.length - 1, currentAnchorIdx + 1)];

      const g = new Float32Array(nFft / 2 + 1);
      const m = mags[i];
      const fluxNorm = Math.min(1.0, fluxes[i] / p90Flux);
      const transientBypass = fluxNorm * transientSens;

      for (let k = 0; k <= nFft / 2; k++) {
        if (freqWeight[k] === 0) {
          g[k] = 1.0;
          continue;
        }
        const noiseEst = (1 - ratio) * n0[k] + ratio * n1[k];
        const snr = (m[k] + 1e-9) / (noiseEst + 1e-9);

        let subG = 1.0 - Math.pow(alpha / snr, 1.2);
        if (subG < minGainLin) subG = minGainLin;
        if (subG > 1.0) subG = 1.0;

        const weightedG = (1.0 - freqWeight[k]) * 1.0 + freqWeight[k] * subG;
        g[k] = (1.0 - transientBypass) * weightedG + transientBypass * 1.0;
      }

      for (let k = 1; k < nFft / 2; k++) {
        if (freqWeight[k] > 0) {
          g[k] = 0.25 * g[k - 1] + 0.5 * g[k] + 0.25 * g[k + 1];
        }
      }

      if (i > 0) {
        const prevG = gains[i - 1];
        const smoothWeight = params.smoothing === 'high' ? 0.8 : (params.smoothing === 'med' ? 0.65 : 0.45);
        for (let k = 0; k <= nFft / 2; k++) {
          g[k] = (1.0 - smoothWeight) * g[k] + smoothWeight * prevG[k];
        }
      }

      gains[i] = g;
    }

    // Channel 0: Generate 2D Attenuation & Transient Bypass Map
    if (ch === 0) {
      const mapW = 400; // Time slices
      const mapH = 120; // Frequency bins (log scale)
      const offCvs = document.createElement('canvas');
      offCvs.width = mapW;
      offCvs.height = mapH;
      const offCtx = offCvs.getContext('2d')!;
      const imgData = offCtx.createImageData(mapW, mapH);
      const pixels = imgData.data;

      const attacks = new Float32Array(mapW);
      const nyquist = sr / 2;
      const maxAttDb = Math.max(6.0, params.amountDb);

      for (let x = 0; x < mapW; x++) {
        const frameIdx = Math.min(numFrames - 1, Math.floor((x / (mapW - 1)) * (numFrames - 1)));
        const gFrame = gains[frameIdx];
        const fluxNorm = Math.min(1.0, fluxes[frameIdx] / p90Flux);
        attacks[x] = fluxNorm * transientSens; // 0.0 - 1.0

        for (let y = 0; y < mapH; y++) {
          // y = 0 is Nyquist (top), y = mapH - 1 is 20Hz (bottom)
          const normY = (mapH - 1 - y) / (mapH - 1);
          const freq = 20 * Math.pow(nyquist / 20, normY);
          let k = Math.round((freq / nyquist) * (nFft / 2));
          if (k < 0) k = 0;
          if (k > nFft / 2) k = nFft / 2;

          const gainVal = gFrame[k];
          // Attenuation in dB: 0dB is gain=1.0, -12dB is gain=0.25
          const attDb = -20 * Math.log10(Math.max(1e-4, gainVal));
          const attRatio = Math.min(1.0, Math.max(0.0, attDb / maxAttDb));

          const pIdx = (y * mapW + x) * 4;
          if (attRatio <= 0.02) {
            // Background color (#06080e)
            pixels[pIdx] = 6;
            pixels[pIdx + 1] = 8;
            pixels[pIdx + 2] = 14;
            pixels[pIdx + 3] = 255;
          } else {
            // Studio Cyan Gradient: Deep to Crisp Cyan
            const r = Math.round(6 * (1 - attRatio) + 0 * attRatio);
            const g = Math.round(8 * (1 - attRatio) + 180 * attRatio);
            const b = Math.round(14 * (1 - attRatio) + 216 * attRatio);
            pixels[pIdx] = r;
            pixels[pIdx + 1] = g;
            pixels[pIdx + 2] = b;
            pixels[pIdx + 3] = 255;
          }
        }
      }

      offCtx.putImageData(imgData, 0, 0);
      map2DData = {
        offscreenCanvas: offCvs,
        attacks: attacks,
        duration: srcBuffer.duration,
        cutoffHz: params.cutoffHz,
        amountDb: params.amountDb,
        sampleRate: sr
      };
    }

    // ISTFT Synthesis
    for (let i = 0; i < numFrames; i++) {
      const m = mags[i];
      const p = phases[i];
      const g = gains[i];

      for (let k = 0; k <= nFft / 2; k++) {
        const cleanMag = m[k] * g[k];
        const cosP = Math.cos(p[k]);
        const sinP = Math.sin(p[k]);
        specReal[k] = cleanMag * cosP;
        specImag[k] = cleanMag * sinP;

        // Highs Clean: Direct STFT frequency isolation perfectly matching Delta cutoff ramp
        const w = freqWeight[k];
        specRealHigh[k] = cleanMag * w * cosP;
        specImagHigh[k] = cleanMag * w * sinP;
      }

      fftEngine.ifft(specReal, specImag, synthFrame);
      fftEngine.ifft(specRealHigh, specImagHigh, synthFrameHigh);

      const start = i * hop;
      for (let j = 0; j < nFft; j++) {
        outClean[start + j] += synthFrame[j];
        outHighsClean[start + j] += synthFrameHigh[j];
        const w = fftEngine.hannWindow[j];
        winSum[start + j] += w * w;
      }

      if (i % 150 === 0 && onProgress) {
        const pct = 50 + Math.round(((ch * numFrames + i) / (numChannels * numFrames * 2)) * 50);
        await onProgress(pct, `Synthesizing audio (${ch + 1}/${numChannels}ch)...`);
        await new Promise(r => setTimeout(r, 0));
      }
    }

    for (let i = 0; i < totalSamples; i++) {
      if (winSum[i] > 1e-6) {
        const invW = 1.0 / winSum[i];
        outClean[i] *= invW;
        outHighsClean[i] *= invW;
      }
    }

    const outDelta = new Float32Array(totalSamples);
    for (let i = 0; i < totalSamples; i++) {
      outDelta[i] = inputData[i] - outClean[i];
    }

    denoisedChannels.push(outClean);
    deltaChannels.push(outDelta);
    highsCleanChannels.push(outHighsClean);
  }

  const cleanBuf = audioCtx.createBuffer(numChannels, totalSamples, sr);
  const deltaBuf = audioCtx.createBuffer(numChannels, totalSamples, sr);
  const highsCleanBuf = audioCtx.createBuffer(numChannels, totalSamples, sr);
  for (let ch = 0; ch < numChannels; ch++) {
    cleanBuf.getChannelData(ch).set(denoisedChannels[ch]);
    deltaBuf.getChannelData(ch).set(deltaChannels[ch]);
    highsCleanBuf.getChannelData(ch).set(highsCleanChannels[ch]);
  }

  // Calculate clean noise floor for timeline
  const hopT = 2048;
  const numSlices = Math.floor(totalSamples / hopT);
  const noiseClean = new Float32Array(numSlices);
  const clL = denoisedChannels[0];
  const clR = numChannels > 1 ? denoisedChannels[1] : clL;

  for (let i = 0; i < numSlices; i++) {
    const start = i * hopT;
    let diffSq = 0;
    for (let j = 1; j < 2048 && (start + j) < totalSamples; j++) {
      const s = (clL[start + j] + clR[start + j]) * 0.5;
      const prev = (clL[start + j - 1] + clR[start + j - 1]) * 0.5;
      const d = s - prev;
      diffSq += d * d;
    }
    const hfProxy = Math.sqrt(diffSq / 2048);
    noiseClean[i] = Math.max(-80, 20 * Math.log10(hfProxy + 1e-9));
  }

  return {
    result: {
      denoisedBuffer: cleanBuf,
      deltaBuffer: deltaBuf,
      highsCleanBuffer: highsCleanBuf,
      map2DData: map2DData!,
      noiseClean
    },
    stftCache
  };
}
