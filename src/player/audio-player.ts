/**
 * Web Audio API AudioPlayer
 * Manages AudioContext, AnalyserNode, AudioBufferSourceNode, loop, seek, and seamless buffer hot-swapping
 */

export class AudioPlayer {
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;
  private currentBuffer: AudioBuffer | null = null;
  private isPlayingState = false;
  private isLoopState = false;
  private startTime = 0;
  private pauseOffset = 0;

  public onEnded?: () => void;
  public onStateChange?: (isPlaying: boolean) => void;

  /**
   * Lazily initializes and returns the AudioContext
   */
  getAudioContext(): AudioContext {
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new AudioContextClass();
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.8;
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  get isPlaying(): boolean {
    return this.isPlayingState;
  }

  get isLoop(): boolean {
    return this.isLoopState;
  }

  setLoop(loop: boolean): void {
    this.isLoopState = loop;
    if (this.sourceNode) {
      this.sourceNode.loop = loop;
    }
  }

  setBuffer(buffer: AudioBuffer | null): void {
    this.currentBuffer = buffer;
  }

  getCurrentBuffer(): AudioBuffer | null {
    return this.currentBuffer;
  }

  getCurrentTime(): number {
    if (!this.isPlayingState || !this.audioCtx) {
      return this.pauseOffset;
    }
    let t = this.audioCtx.currentTime - this.startTime;
    const dur = this.currentBuffer ? this.currentBuffer.duration : 1;
    if (this.isLoopState) {
      t = t % dur;
    }
    return Math.min(dur, Math.max(0, t));
  }

  /**
   * Starts or resumes playback at the specified offset in seconds
   */
  start(offsetSec: number = 0, bufferOverride?: AudioBuffer): void {
    const buffer = bufferOverride || this.currentBuffer;
    if (!buffer) return;
    this.currentBuffer = buffer;

    this.stop(false);
    const ctx = this.getAudioContext();

    this.sourceNode = ctx.createBufferSource();
    this.sourceNode.buffer = buffer;
    this.sourceNode.loop = this.isLoopState;

    if (this.analyser) {
      this.sourceNode.connect(this.analyser);
      this.analyser.connect(ctx.destination);
    } else {
      this.sourceNode.connect(ctx.destination);
    }

    this.startTime = ctx.currentTime - offsetSec;
    this.pauseOffset = offsetSec;
    this.sourceNode.start(0, offsetSec);
    this.isPlayingState = true;
    this.onStateChange?.(true);

    this.sourceNode.onended = () => {
      if (this.isPlayingState && !this.isLoopState) {
        const cur = this.getCurrentTime();
        if (cur >= buffer.duration - 0.1) {
          this.stop(true);
          this.onEnded?.();
        }
      }
    };
  }

  /**
   * Pauses playback and retains current position
   */
  pause(): void {
    if (!this.isPlayingState) return;
    this.pauseOffset = this.getCurrentTime();
    this.stop(false);
  }

  /**
   * Stops playback and optionally resets position to 0
   */
  stop(resetToZero: boolean = false): void {
    if (this.sourceNode) {
      try {
        this.sourceNode.onended = null;
        this.sourceNode.stop();
        this.sourceNode.disconnect();
      } catch {
        // Ignore errors if already stopped
      }
      this.sourceNode = null;
    }
    this.isPlayingState = false;
    this.onStateChange?.(false);

    if (resetToZero) {
      this.pauseOffset = 0;
    }
  }

  /**
   * Seamless hot-swap: switches active AudioBuffer without interrupting playback
   */
  switchBuffer(newBuffer: AudioBuffer): void {
    this.currentBuffer = newBuffer;
    if (this.isPlayingState) {
      const curTime = this.getCurrentTime();
      this.start(curTime, newBuffer);
    }
  }

  /**
   * Seeks to target second
   */
  seek(targetSec: number): void {
    if (this.isPlayingState) {
      this.start(targetSec);
    } else {
      this.pauseOffset = targetSec;
    }
  }
}
