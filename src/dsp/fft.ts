/**
 * Fast In-Place Radix-2 Cooley-Tukey FFT / IFFT Engine
 * Pure TypeScript implementation with zero external dependencies
 */

export class FastRadix2FFT {
  readonly size: number;
  readonly cosTable: Float32Array;
  readonly sinTable: Float32Array;
  readonly hannWindow: Float32Array;
  readonly bitRev: Uint32Array;
  private readonly real: Float32Array;
  private readonly imag: Float32Array;

  constructor(size: number = 2048) {
    this.size = size;
    this.cosTable = new Float32Array(size / 2);
    this.sinTable = new Float32Array(size / 2);
    this.hannWindow = new Float32Array(size);
    this.bitRev = new Uint32Array(size);

    for (let i = 0; i < size / 2; i++) {
      this.cosTable[i] = Math.cos((-2 * Math.PI * i) / size);
      this.sinTable[i] = Math.sin((-2 * Math.PI * i) / size);
    }
    for (let i = 0; i < size; i++) {
      this.hannWindow[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / size));
    }

    let j = 0;
    for (let i = 0; i < size - 1; i++) {
      this.bitRev[i] = j;
      let k = size >> 1;
      while (k <= j) {
        j -= k;
        k >>= 1;
      }
      j += k;
    }
    this.bitRev[size - 1] = size - 1;

    this.real = new Float32Array(size);
    this.imag = new Float32Array(size);
  }

  /**
   * Forward Real-to-Complex FFT with Hann windowing
   */
  fft(timeDomain: Float32Array, outReal: Float32Array, outImag: Float32Array): void {
    const n = this.size;
    const real = this.real;
    const imag = this.imag;
    const win = this.hannWindow;
    const bitRev = this.bitRev;

    for (let i = 0; i < n; i++) {
      const rev = bitRev[i];
      real[rev] = timeDomain[i] * win[i];
      imag[rev] = 0;
    }

    for (let halfSize = 1; halfSize < n; halfSize <<= 1) {
      const step = halfSize << 1;
      const tableStep = n / step;
      for (let i = 0; i < n; i += step) {
        for (let j = 0; j < halfSize; j++) {
          const k = j * tableStep;
          const c = this.cosTable[k];
          const s = this.sinTable[k];
          const tr = real[i + j + halfSize] * c - imag[i + j + halfSize] * s;
          const ti = real[i + j + halfSize] * s + imag[i + j + halfSize] * c;
          real[i + j + halfSize] = real[i + j] - tr;
          imag[i + j + halfSize] = imag[i + j] - ti;
          real[i + j] += tr;
          imag[i + j] += ti;
        }
      }
    }

    for (let i = 0; i <= n / 2; i++) {
      outReal[i] = real[i];
      outImag[i] = imag[i];
    }
  }

  /**
   * Inverse Complex-to-Real FFT with Hann synthesis window weighting
   */
  ifft(inReal: Float32Array, inImag: Float32Array, outTimeDomain: Float32Array): void {
    const n = this.size;
    const real = this.real;
    const imag = this.imag;
    const bitRev = this.bitRev;

    // Fill Hermitian symmetric spectrum
    for (let i = 0; i <= n / 2; i++) {
      const rev = bitRev[i];
      real[rev] = inReal[i];
      imag[rev] = inImag[i];
    }
    for (let i = n / 2 + 1; i < n; i++) {
      const rev = bitRev[i];
      const sym = n - i;
      real[rev] = inReal[sym];
      imag[rev] = -inImag[sym];
    }

    for (let halfSize = 1; halfSize < n; halfSize <<= 1) {
      const step = halfSize << 1;
      const tableStep = n / step;
      for (let i = 0; i < n; i += step) {
        for (let j = 0; j < halfSize; j++) {
          const k = j * tableStep;
          const c = this.cosTable[k];
          const s = -this.sinTable[k]; // Conjugate for inverse FFT
          const tr = real[i + j + halfSize] * c - imag[i + j + halfSize] * s;
          const ti = real[i + j + halfSize] * s + imag[i + j + halfSize] * c;
          real[i + j + halfSize] = real[i + j] - tr;
          imag[i + j + halfSize] = imag[i + j] - ti;
          real[i + j] += tr;
          imag[i + j] += ti;
        }
      }
    }

    const win = this.hannWindow;
    const invN = 1.0 / n;
    for (let i = 0; i < n; i++) {
      outTimeDomain[i] = real[i] * invN * win[i];
    }
  }
}
