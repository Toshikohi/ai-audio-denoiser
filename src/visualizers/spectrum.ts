/**
 * Realtime Multi-spectrum Canvas Visualizer
 */

import type { MonitoringMode } from '../types';

const spectrumData = new Uint8Array(1024);

export function drawSpectrum(
  canvas: HTMLCanvasElement,
  analyser: AnalyserNode | null,
  isPlaying: boolean,
  rawBuffer: AudioBuffer | null,
  cutoffHz: number,
  activeMode: MonitoringMode
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;

  ctx.fillStyle = '#06080e';
  ctx.fillRect(0, 0, w, h);

  if (!analyser || !isPlaying) return;

  analyser.getByteFrequencyData(spectrumData);
  const binCount = spectrumData.length;
  const nyquist = (rawBuffer ? rawBuffer.sampleRate : 48000) / 2;

  // Frequency Grid Lines (Log Scale: 100, 500, 1k, 3k, 6k, 10k, 16k)
  const gridFreqs = [100, 500, 1000, 3000, 6000, 10000, 16000];
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.font = '9px monospace';
  ctx.lineWidth = 1;

  gridFreqs.forEach(f => {
    if (f < nyquist) {
      const logX = Math.log10(f / 20) / Math.log10(nyquist / 20);
      const x = logX * w;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
      ctx.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, x + 2, h - 4);
    }
  });

  // Draw Target Cutoff Indicator Zone
  const cutoffLogX = Math.log10(cutoffHz / 20) / Math.log10(nyquist / 20);
  const cutoffX = cutoffLogX * w;
  ctx.fillStyle = 'rgba(0, 242, 254, 0.06)';
  ctx.fillRect(cutoffX, 0, w - cutoffX, h);
  ctx.strokeStyle = 'rgba(0, 242, 254, 0.4)';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(cutoffX, 0);
  ctx.lineTo(cutoffX, h);
  ctx.stroke();
  ctx.setLineDash([]);

  let strokeColor = '#10b981'; // Green (Denoised)
  let fillColor = 'rgba(16, 185, 129, 0.15)';
  if (activeMode === 'original') {
    strokeColor = '#3b82f6';
    fillColor = 'rgba(59, 130, 246, 0.15)';
  } else if (activeMode === 'delta') {
    strokeColor = '#f72585';
    fillColor = 'rgba(247, 37, 133, 0.2)';
  } else if (activeMode === 'highs-clean') {
    strokeColor = '#00f2fe';
    fillColor = 'rgba(0, 242, 254, 0.25)';
  }

  ctx.strokeStyle = strokeColor;
  ctx.fillStyle = fillColor;
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.moveTo(0, h);

  for (let i = 1; i < binCount; i++) {
    const freq = (i * nyquist) / binCount;
    if (freq < 20) continue;
    const logX = Math.log10(freq / 20) / Math.log10(nyquist / 20);
    const x = logX * w;
    const val = spectrumData[i] / 255.0;
    const y = h * (1.0 - val);

    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}
