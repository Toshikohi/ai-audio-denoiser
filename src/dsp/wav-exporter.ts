/**
 * WAV Binary Exporter (16-bit TPDF Dither / 24-bit PCM / 32-bit Float)
 * Zero external dependencies
 */

import type { ExportOptions } from '../types';

/**
 * Encodes an AudioBuffer into a WAV Blob
 */
export function audioBufferToWavBlob(buffer: AudioBuffer, bitDepth: number = 24): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const is32Bit = bitDepth === 32;
  const is24Bit = bitDepth === 24;
  const bytesPerSample = is32Bit ? 4 : (is24Bit ? 3 : 2);
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = length * blockAlign;
  const totalSize = 44 + dataSize;
  const arrayBuffer = new ArrayBuffer(totalSize);
  const view = new DataView(arrayBuffer);

  function writeString(offset: number, string: string): void {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  // RIFF Header
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');

  // fmt sub-chunk
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, is32Bit ? 3 : 1, true); // 1 = PCM, 3 = IEEE Float
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);

  // data sub-chunk
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  const chL = buffer.getChannelData(0);
  const chR = numChannels > 1 ? buffer.getChannelData(1) : chL;
  let offset = 44;

  if (is32Bit) {
    // 32-bit Float
    for (let i = 0; i < length; i++) {
      view.setFloat32(offset, chL[i], true);
      offset += 4;
      if (numChannels > 1) {
        view.setFloat32(offset, chR[i], true);
        offset += 4;
      }
    }
  } else if (is24Bit) {
    // 24-bit PCM
    for (let i = 0; i < length; i++) {
      const sL = Math.max(-1, Math.min(1, chL[i]));
      let valL = Math.max(-8388608, Math.min(8388607, Math.round(sL * 8388607)));
      if (valL < 0) valL += 16777216;
      view.setUint8(offset, valL & 0xFF);
      view.setUint8(offset + 1, (valL >> 8) & 0xFF);
      view.setUint8(offset + 2, (valL >> 16) & 0xFF);
      offset += 3;

      if (numChannels > 1) {
        const sR = Math.max(-1, Math.min(1, chR[i]));
        let valR = Math.max(-8388608, Math.min(8388607, Math.round(sR * 8388607)));
        if (valR < 0) valR += 16777216;
        view.setUint8(offset, valR & 0xFF);
        view.setUint8(offset + 1, (valR >> 8) & 0xFF);
        view.setUint8(offset + 2, (valR >> 16) & 0xFF);
        offset += 3;
      }
    }
  } else {
    // 16-bit PCM with Triangular PDF Dithering (TPDF)
    for (let i = 0; i < length; i++) {
      const ditherL = (Math.random() - Math.random()) / 32768;
      const sL = Math.max(-1, Math.min(1, chL[i] + ditherL));
      view.setInt16(offset, sL < 0 ? Math.round(sL * 0x8000) : Math.round(sL * 0x7FFF), true);
      offset += 2;

      if (numChannels > 1) {
        const ditherR = (Math.random() - Math.random()) / 32768;
        const sR = Math.max(-1, Math.min(1, chR[i] + ditherR));
        view.setInt16(offset, sR < 0 ? Math.round(sR * 0x8000) : Math.round(sR * 0x7FFF), true);
        offset += 2;
      }
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

/**
 * Resamples and exports the given AudioBuffer as a WAV file download
 */
export async function exportWavFile(
  sourceBuffer: AudioBuffer,
  options: ExportOptions,
  baseFileName: string
): Promise<void> {
  let finalBuffer = sourceBuffer;

  // Resample if different sample rate requested
  if (options.targetSampleRate !== 'source') {
    const targetRate = options.targetSampleRate;
    if (targetRate !== sourceBuffer.sampleRate) {
      const OfflineCtxClass = window.OfflineAudioContext || (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
      const targetLength = Math.round(sourceBuffer.duration * targetRate);
      const offlineCtx = new OfflineCtxClass(sourceBuffer.numberOfChannels, targetLength, targetRate);
      const srcNode = offlineCtx.createBufferSource();
      srcNode.buffer = sourceBuffer;
      srcNode.connect(offlineCtx.destination);
      srcNode.start(0);
      finalBuffer = await offlineCtx.startRendering();
    }
  }

  const blob = audioBufferToWavBlob(finalBuffer, options.bitDepth);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safeBaseName = (baseFileName || 'audio').replace(/\.[^/.]+$/, '');
  a.download = `${safeBaseName}_${options.targetMode}_${options.bitDepth}bit.wav`;
  a.href = url;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
