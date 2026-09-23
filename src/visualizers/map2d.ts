/**
 * 2D Attenuation & Transient Bypass Map Canvas Visualizer
 */

import type { Map2DData } from '../types';
import { formatTime } from '../utils/format';

export function draw2DMap(
  canvas: HTMLCanvasElement,
  mapData: Map2DData | null,
  rawBuffer: AudioBuffer | null,
  currentPlaybackTime: number
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

  if (!mapData || !rawBuffer) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.font = '12px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Process audio to display 2D attenuation and transient bypass map', w / 2, h / 2);
    return;
  }

  const dur = mapData.duration;
  const attacks = mapData.attacks;
  const nAttacks = attacks.length;

  // Top Meter (Transient Attack Protection): 34px height
  const topH = 34;
  const bottomH = h - topH;

  // 1. Top Section: Transient Attack Protection Meter (0% - 100%)
  ctx.fillStyle = '#090d16';
  ctx.fillRect(0, 0, w, topH);

  // Grid & Labels for Top Section
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, topH);
  ctx.lineTo(w, topH);
  ctx.stroke();

  ctx.fillStyle = 'rgba(251, 191, 36, 0.85)';
  ctx.font = '9px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('⚡ Transient Attack Protection (Bypass Rate)', 8, 12);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.textAlign = 'right';
  ctx.fillText('100%', w - 8, 12);
  ctx.fillText('0%', w - 8, topH - 3);

  // Attack bypass line & fill
  ctx.strokeStyle = '#fbbf24';
  ctx.fillStyle = 'rgba(251, 191, 36, 0.15)';
  ctx.lineWidth = 1.5;

  ctx.beginPath();
  ctx.moveTo(0, topH - 2);
  for (let i = 0; i < nAttacks; i++) {
    const x = (i / (nAttacks - 1)) * w;
    const val = Math.min(1.0, Math.max(0.0, attacks[i]));
    const y = (topH - 2) - val * (topH - 14);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, topH - 2);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  for (let i = 0; i < nAttacks; i++) {
    const x = (i / (nAttacks - 1)) * w;
    const val = Math.min(1.0, Math.max(0.0, attacks[i]));
    const y = (topH - 2) - val * (topH - 14);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // 2. Bottom Section: 2D Attenuation Heatmap
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(mapData.offscreenCanvas, 0, topH, w, bottomH);
  ctx.restore();

  // Frequency Grid Lines & Labels (Log scale)
  const nyquist = mapData.sampleRate / 2;
  const gridFreqs = [100, 1000, 6000, 10000, 16000];
  ctx.lineWidth = 1;

  gridFreqs.forEach(freq => {
    if (freq >= nyquist) return;
    const logY = Math.log10(freq / 20) / Math.log10(nyquist / 20);
    const y = topH + bottomH * (1.0 - logY);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.font = '9px monospace';
    ctx.textAlign = 'left';
    const label = freq >= 1000 ? `${freq / 1000}kHz` : `${freq}Hz`;
    ctx.fillText(label, 8, y - 2);
  });

  // Cutoff Frequency Indicator Line (Dashed)
  const cutoff = mapData.cutoffHz;
  if (cutoff > 20 && cutoff < nyquist) {
    const cutLogY = Math.log10(cutoff / 20) / Math.log10(nyquist / 20);
    const cutY = topH + bottomH * (1.0 - cutLogY);

    ctx.strokeStyle = 'rgba(251, 191, 36, 0.7)';
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, cutY);
    ctx.lineTo(w, cutY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = 'rgba(251, 191, 36, 0.9)';
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`Cutoff (${(cutoff / 1000).toFixed(1)}kHz)`, w - 8, cutY - 3);
  }

  // Time Grid Lines
  const timeInterval = dur > 180 ? 60 : (dur > 60 ? 30 : 10);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.font = '9px monospace';
  ctx.textAlign = 'center';
  for (let t = timeInterval; t < dur; t += timeInterval) {
    const x = (t / dur) * w;
    ctx.beginPath();
    ctx.moveTo(x, topH);
    ctx.lineTo(x, h);
    ctx.stroke();
    ctx.fillText(formatTime(t), x, h - 3);
  }

  // 3. Playback Head Marker
  const headX = (currentPlaybackTime / dur) * w;
  ctx.strokeStyle = 'rgba(0, 242, 254, 0.95)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(headX, 0);
  ctx.lineTo(headX, h);
  ctx.stroke();

  ctx.fillStyle = 'rgba(0, 242, 254, 0.2)';
  ctx.fillRect(headX - 1.5, 0, 3, h);
}
