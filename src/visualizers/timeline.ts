/**
 * Timeline RMS & Noise Floor Canvas Visualizer
 */

import type { TimelineData } from '../types';

export function drawTimeline(
  canvas: HTMLCanvasElement,
  timelineData: TimelineData | null,
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

  if (!timelineData || !rawBuffer) return;

  const data = timelineData;
  const dur = rawBuffer.duration;
  const n = data.times.length;

  // Grid lines (dB)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.lineWidth = 1;
  [-20, -40, -60].forEach(db => {
    const y = h * (1 - (db + 80) / 80);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.font = '9px monospace';
    ctx.fillText(`${db}dB`, 4, y - 2);
  });

  // 1. RMS Curve (Blue)
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = (data.times[i] / dur) * w;
    const y = h * (1 - (data.rmsOrig[i] + 80) / 80);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // 2. Original HF Noise Floor (Pink)
  ctx.strokeStyle = '#f72585';
  ctx.lineWidth = 2.0;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = (data.times[i] / dur) * w;
    const y = h * (1 - (data.noiseOrig[i] + 80) / 80);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // 3. Cleaned Noise Floor (Green, if computed)
  if (data.noiseClean) {
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = (data.times[i] / dur) * w;
      const y = h * (1 - (data.noiseClean[i] + 80) / 80);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // 4. Playback Head Marker
  const headX = (currentPlaybackTime / dur) * w;
  ctx.strokeStyle = 'rgba(0, 242, 254, 0.9)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(headX, 0);
  ctx.lineTo(headX, h);
  ctx.stroke();

  ctx.fillStyle = 'rgba(0, 242, 254, 0.2)';
  ctx.fillRect(headX - 2, 0, 4, h);
}
