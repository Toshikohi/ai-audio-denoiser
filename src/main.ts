/**
 * AI Audio De-Noiser - Main Application Entrypoint
 * Zero external runtime dependencies
 */

import './styles/main.css';
import type {
  DenoiseParams,
  ExportOptions,
  Map2DData,
  MonitoringMode,
  SmoothingLevel,
  STFTChannelCache,
  TimelineData,
  VisualizerTab
} from './types';
import { computeTimelineAnalysis, runDenoiseCore } from './dsp/denoiser';
import { exportWavFile } from './dsp/wav-exporter';
import { AudioPlayer } from './player/audio-player';
import { drawTimeline } from './visualizers/timeline';
import { draw2DMap } from './visualizers/map2d';
import { drawSpectrum } from './visualizers/spectrum';
import { formatTime } from './utils/format';

// --- State Management ---
interface AppState {
  rawBuffer: AudioBuffer | null;
  denoisedBuffer: AudioBuffer | null;
  deltaBuffer: AudioBuffer | null;
  highsCleanBuffer: AudioBuffer | null;
  activeMonitoringMode: MonitoringMode;
  visualizerTab: VisualizerTab;
  timelineData: TimelineData | null;
  map2DData: Map2DData | null;
  stftCache: STFTChannelCache[] | null;
  isRendering: boolean;
  isDirty: boolean;
  params: DenoiseParams;
  rawFileName: string;
}

const state: AppState = {
  rawBuffer: null,
  denoisedBuffer: null,
  deltaBuffer: null,
  highsCleanBuffer: null,
  activeMonitoringMode: 'denoised',
  visualizerTab: 'rms',
  timelineData: null,
  map2DData: null,
  stftCache: null,
  isRendering: false,
  isDirty: false,
  params: {
    amountDb: 12.0,
    cutoffHz: 6000,
    trackingSec: 1.5,
    transientSens: 0.8,
    alpha: 1.3,
    smoothing: 'med'
  },
  rawFileName: ''
};

const player = new AudioPlayer();

// --- DOM Elements ---
const dropZone = document.getElementById('dropZone') as HTMLElement;
const fileInput = document.getElementById('fileInput') as HTMLInputElement;
const trackMetaBanner = document.getElementById('trackMetaBanner') as HTMLElement;
const metaFileName = document.getElementById('metaFileName') as HTMLElement;
const metaSampleRate = document.getElementById('metaSampleRate') as HTMLElement;
const metaChannels = document.getElementById('metaChannels') as HTMLElement;
const metaDuration = document.getElementById('metaDuration') as HTMLElement;
const btnApplyParams = document.getElementById('btnApplyParams') as HTMLButtonElement;
const paramStatusBadge = document.getElementById('paramStatusBadge') as HTMLElement;

const progressContainer = document.getElementById('progressContainer') as HTMLElement;
const progressStatusText = document.getElementById('progressStatusText') as HTMLElement;
const progressPercentText = document.getElementById('progressPercentText') as HTMLElement;
const progressBarFill = document.getElementById('progressBarFill') as HTMLElement;

const canvasTimeline = document.getElementById('canvasTimeline') as HTMLCanvasElement;
const canvas2DMap = document.getElementById('canvas2DMap') as HTMLCanvasElement;
const containerRMS = document.getElementById('containerRMS') as HTMLElement;
const container2D = document.getElementById('container2D') as HTMLElement;
const tabTimelineRMS = document.getElementById('tabTimelineRMS') as HTMLButtonElement;
const tabTimeline2D = document.getElementById('tabTimeline2D') as HTMLButtonElement;
const visualizerTitle = document.getElementById('visualizerTitle') as HTMLElement;
const legendRMS = document.getElementById('legendRMS') as HTMLElement;
const legend2D = document.getElementById('legend2D') as HTMLElement;
const canvasSpectrum = document.getElementById('canvasSpectrum') as HTMLCanvasElement;

const seekBar = document.getElementById('seekBar') as HTMLInputElement;
const timeCurrent = document.getElementById('timeCurrent') as HTMLElement;
const timeTotal = document.getElementById('timeTotal') as HTMLElement;
const btnPlayPause = document.getElementById('btnPlayPause') as HTMLButtonElement;
const iconPlay = document.getElementById('iconPlay') as unknown as SVGElement;
const labelPlay = document.getElementById('labelPlay') as HTMLElement;
const btnLoop = document.getElementById('btnLoop') as HTMLButtonElement;

const abButtons = document.querySelectorAll<HTMLButtonElement>('.ab-btn');
const sliderAmount = document.getElementById('sliderAmount') as HTMLInputElement;
const valAmount = document.getElementById('valAmount') as HTMLElement;
const sliderCutoff = document.getElementById('sliderCutoff') as HTMLInputElement;
const valCutoff = document.getElementById('valCutoff') as HTMLElement;
const sliderTracking = document.getElementById('sliderTracking') as HTMLInputElement;
const valTracking = document.getElementById('valTracking') as HTMLElement;
const sliderTransient = document.getElementById('sliderTransient') as HTMLInputElement;
const valTransient = document.getElementById('valTransient') as HTMLElement;
const sliderAlpha = document.getElementById('sliderAlpha') as HTMLInputElement;
const valAlpha = document.getElementById('valAlpha') as HTMLElement;
const selectSmoothing = document.getElementById('selectSmoothing') as HTMLSelectElement;
const valSmoothing = document.getElementById('valSmoothing') as HTMLElement;

const btnConfirmExport = document.getElementById('btnConfirmExport') as HTMLButtonElement;
const exportSampleRate = document.getElementById('exportSampleRate') as HTMLSelectElement;
const exportBitDepth = document.getElementById('exportBitDepth') as HTMLSelectElement;
const exportTargetMode = document.getElementById('exportTargetMode') as HTMLSelectElement;

// --- Helper Functions ---
function getActiveAudioBuffer(): AudioBuffer | null {
  switch (state.activeMonitoringMode) {
    case 'original':
      return state.rawBuffer;
    case 'delta':
      return state.deltaBuffer;
    case 'highs-clean':
      return state.highsCleanBuffer || state.denoisedBuffer;
    case 'denoised':
    default:
      return state.denoisedBuffer || state.rawBuffer;
  }
}

function redrawActiveTimelineOrMap(): void {
  const curTime = player.getCurrentTime();
  if (state.visualizerTab === '2d') {
    draw2DMap(canvas2DMap, state.map2DData, state.rawBuffer, curTime);
  } else {
    drawTimeline(canvasTimeline, state.timelineData, state.rawBuffer, curTime);
  }
}

function markParamsDirty(): void {
  if (!state.rawBuffer) return;
  state.isDirty = true;
  if (paramStatusBadge) {
    paramStatusBadge.textContent = '🟡 未適用の変更あり (Applyで反映)';
    paramStatusBadge.style.color = 'var(--accent-yellow)';
    paramStatusBadge.style.borderColor = 'rgba(245, 158, 11, 0.4)';
    paramStatusBadge.style.background = 'rgba(245, 158, 11, 0.12)';
  }
  if (btnApplyParams) {
    btnApplyParams.disabled = false;
    btnApplyParams.classList.add('btn-apply-active');
    btnApplyParams.innerHTML = '⚡ 変更を適用 (Apply)';
  }
}

function markParamsClean(): void {
  state.isDirty = false;
  if (paramStatusBadge) {
    paramStatusBadge.textContent = '🟢 適用済み';
    paramStatusBadge.style.color = 'var(--accent-green)';
    paramStatusBadge.style.borderColor = 'rgba(16, 185, 129, 0.3)';
    paramStatusBadge.style.background = 'rgba(16, 185, 129, 0.1)';
  }
  if (btnApplyParams) {
    btnApplyParams.disabled = true;
    btnApplyParams.classList.remove('btn-apply-active');
    btnApplyParams.innerHTML = '⚡ 変更を適用 (Apply)';
  }
}

function updatePlayButtonUI(isPlaying: boolean): void {
  if (isPlaying) {
    iconPlay.innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
    labelPlay.textContent = 'Pause';
  } else {
    iconPlay.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>';
    labelPlay.textContent = 'Play';
  }
}

function setActiveMonitoringMode(mode: MonitoringMode): void {
  state.activeMonitoringMode = mode;
  abButtons.forEach(btn => {
    if (btn.dataset.mode === mode) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  const nextBuffer = getActiveAudioBuffer();
  if (nextBuffer) {
    player.switchBuffer(nextBuffer);
  }
}

// --- Denoise Execution Pipeline ---
async function executeDenoise(isInitialLoad: boolean = false): Promise<void> {
  if (!state.rawBuffer || state.isRendering) return;
  state.isRendering = true;

  const wasPlaying = player.isPlaying;
  const curTime = player.getCurrentTime();

  progressContainer.style.display = 'flex';
  progressStatusText.textContent = isInitialLoad
    ? 'Analyzing audio & initial rendering...'
    : 'Applying noise reduction parameters...';
  progressPercentText.textContent = state.stftCache ? '20%' : '5%';
  progressBarFill.style.width = state.stftCache ? '20%' : '5%';

  if (btnApplyParams) {
    btnApplyParams.disabled = true;
    btnApplyParams.classList.remove('btn-apply-active');
    btnApplyParams.innerHTML = '<span class="spinner-sm"></span> 適用中...';
  }
  if (paramStatusBadge) {
    paramStatusBadge.innerHTML = '<span class="spinner-sm"></span> ノイズ除去処理中...';
    paramStatusBadge.style.color = 'var(--accent-yellow)';
    paramStatusBadge.style.borderColor = 'rgba(245, 158, 11, 0.4)';
    paramStatusBadge.style.background = 'rgba(245, 158, 11, 0.1)';
  }

  // Yield 1 frame to ensure DOM paint completes before intensive DSP
  await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

  try {
    const audioCtx = player.getAudioContext();
    const { result, stftCache } = await runDenoiseCore({
      audioCtx,
      srcBuffer: state.rawBuffer,
      params: state.params,
      cachedSTFT: state.stftCache,
      onProgress: (pct, status) => {
        progressStatusText.textContent = status;
        progressPercentText.textContent = `${pct}%`;
        progressBarFill.style.width = `${pct}%`;
      }
    });

    state.stftCache = stftCache;
    state.denoisedBuffer = result.denoisedBuffer;
    state.deltaBuffer = result.deltaBuffer;
    state.highsCleanBuffer = result.highsCleanBuffer;
    state.map2DData = result.map2DData;

    if (state.timelineData) {
      state.timelineData.noiseClean = result.noiseClean;
    }

    redrawActiveTimelineOrMap();

    progressContainer.style.display = 'none';
    btnPlayPause.disabled = false;
    seekBar.disabled = false;
    btnConfirmExport.disabled = false;
    timeTotal.textContent = formatTime(state.rawBuffer.duration);

    markParamsClean();

    if (isInitialLoad) {
      setActiveMonitoringMode('denoised');
      player.start(0, result.denoisedBuffer);
    } else if (wasPlaying && state.activeMonitoringMode !== 'original') {
      const activeBuf = getActiveAudioBuffer();
      if (activeBuf) {
        player.start(curTime, activeBuf);
      }
    }
  } catch (err) {
    console.error('Denoise failed', err);
    alert('ノイズ低減処理中にエラーが発生しました: ' + (err as Error).message);
    progressContainer.style.display = 'none';
  } finally {
    state.isRendering = false;
  }
}

// --- File Loading ---
async function loadFile(file: File): Promise<void> {
  player.stop(true);
  state.rawFileName = file.name;
  metaFileName.textContent = file.name;
  progressContainer.style.display = 'flex';
  progressStatusText.textContent = 'Decoding audio file...';
  progressPercentText.textContent = '';
  progressBarFill.style.width = '20%';

  try {
    const arrayBuffer = await file.arrayBuffer();
    progressBarFill.style.width = '50%';
    const audioCtx = player.getAudioContext();
    const decoded = await audioCtx.decodeAudioData(arrayBuffer);

    state.rawBuffer = decoded;
    state.denoisedBuffer = null;
    state.deltaBuffer = null;
    state.highsCleanBuffer = null;
    state.stftCache = null;

    metaSampleRate.textContent = `${decoded.sampleRate.toLocaleString()} Hz`;
    metaChannels.textContent = decoded.numberOfChannels === 1 ? 'Mono (1ch)' : 'Stereo (2ch)';
    metaDuration.textContent = formatTime(decoded.duration);
    trackMetaBanner.style.display = 'flex';

    progressContainer.style.display = 'none';
    btnConfirmExport.disabled = true;

    // Timeline pre-analysis
    state.timelineData = computeTimelineAnalysis(decoded);
    redrawActiveTimelineOrMap();

    // Auto-run denoise
    await executeDenoise(true);
  } catch (err) {
    console.error('Decode failed', err);
    alert('音声ファイルのデコードに失敗しました: ' + (err as Error).message);
    progressContainer.style.display = 'none';
  }
}

// --- Animation Loop ---
function renderVisualizerLoop(): void {
  if (player.isPlaying && state.rawBuffer) {
    const cur = player.getCurrentTime();
    timeCurrent.textContent = formatTime(cur);
    seekBar.value = `${(cur / state.rawBuffer.duration) * 100}`;
    redrawActiveTimelineOrMap();
    drawSpectrum(
      canvasSpectrum,
      player.getAnalyser(),
      player.isPlaying,
      state.rawBuffer,
      state.params.cutoffHz,
      state.activeMonitoringMode
    );
  }
  requestAnimationFrame(renderVisualizerLoop);
}

// --- Event Listeners Setup ---
function setupEventListeners(): void {
  // Player State Callback
  player.onStateChange = isPlaying => {
    updatePlayButtonUI(isPlaying);
  };
  player.onEnded = () => {
    timeCurrent.textContent = '0:00';
    seekBar.value = '0';
    redrawActiveTimelineOrMap();
  };

  // Drag and drop
  dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer && e.dataTransfer.files.length > 0) {
      loadFile(e.dataTransfer.files[0]);
    }
  });
  fileInput.addEventListener('change', e => {
    const target = e.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
      loadFile(target.files[0]);
    }
  });

  // Playback controls
  btnPlayPause.addEventListener('click', () => {
    if (player.isPlaying) {
      player.pause();
    } else {
      const activeBuf = getActiveAudioBuffer();
      if (activeBuf) {
        player.start(player.getCurrentTime(), activeBuf);
      }
    }
  });

  btnLoop.addEventListener('click', () => {
    const newLoop = !player.isLoop;
    player.setLoop(newLoop);
    btnLoop.style.opacity = newLoop ? '1.0' : '0.6';
    btnLoop.style.borderColor = newLoop ? 'var(--accent-cyan)' : 'var(--border-color)';
  });

  seekBar.addEventListener('input', () => {
    if (!state.rawBuffer) return;
    const targetSec = (parseFloat(seekBar.value) / 100) * state.rawBuffer.duration;
    timeCurrent.textContent = formatTime(targetSec);
    const activeBuf = getActiveAudioBuffer();
    if (activeBuf) {
      player.setBuffer(activeBuf);
      player.seek(targetSec);
    }
    redrawActiveTimelineOrMap();
  });

  // A/B Monitoring Buttons
  abButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode as MonitoringMode;
      if (mode) {
        setActiveMonitoringMode(mode);
      }
    });
  });

  // Sliders and dirty state
  sliderAmount.addEventListener('input', e => {
    state.params.amountDb = parseFloat((e.target as HTMLInputElement).value);
    valAmount.textContent = `${state.params.amountDb.toFixed(1)} dB`;
    markParamsDirty();
  });
  sliderCutoff.addEventListener('input', e => {
    state.params.cutoffHz = parseInt((e.target as HTMLInputElement).value, 10);
    valCutoff.textContent = `${state.params.cutoffHz.toLocaleString()} Hz`;
    markParamsDirty();
  });
  sliderTracking.addEventListener('input', e => {
    state.params.trackingSec = parseFloat((e.target as HTMLInputElement).value);
    valTracking.textContent = `${state.params.trackingSec.toFixed(2)} sec`;
    markParamsDirty();
  });
  sliderTransient.addEventListener('input', e => {
    state.params.transientSens = parseFloat((e.target as HTMLInputElement).value) / 100.0;
    valTransient.textContent = `${(e.target as HTMLInputElement).value} %`;
    markParamsDirty();
  });
  sliderAlpha.addEventListener('input', e => {
    state.params.alpha = parseFloat((e.target as HTMLInputElement).value);
    valAlpha.textContent = `${state.params.alpha.toFixed(2)} x`;
    markParamsDirty();
  });
  selectSmoothing.addEventListener('change', e => {
    const sel = e.target as HTMLSelectElement;
    state.params.smoothing = sel.value as SmoothingLevel;
    if (valSmoothing) {
      valSmoothing.textContent = sel.options[sel.selectedIndex].text.split(' ')[0];
    }
    markParamsDirty();
  });

  // Apply Button (Immediate Spinner Feedback)
  btnApplyParams.addEventListener('click', () => {
    btnApplyParams.disabled = true;
    btnApplyParams.classList.remove('btn-apply-active');
    btnApplyParams.innerHTML = '<span class="spinner-sm"></span> 適用中...';
    if (paramStatusBadge) {
      paramStatusBadge.innerHTML = '<span class="spinner-sm"></span> ノイズ除去処理中...';
      paramStatusBadge.style.color = 'var(--accent-yellow)';
      paramStatusBadge.style.borderColor = 'rgba(245, 158, 11, 0.4)';
      paramStatusBadge.style.background = 'rgba(245, 158, 11, 0.1)';
    }
    progressContainer.style.display = 'flex';
    progressStatusText.textContent = 'Applying noise reduction parameters...';
    progressPercentText.textContent = state.stftCache ? '20%' : '5%';
    progressBarFill.style.width = state.stftCache ? '20%' : '5%';

    requestAnimationFrame(() => {
      setTimeout(() => {
        executeDenoise(false);
      }, 0);
    });
  });

  // Visualizer Tabs
  tabTimelineRMS.addEventListener('click', () => {
    state.visualizerTab = 'rms';
    tabTimelineRMS.classList.add('active');
    tabTimeline2D.classList.remove('active');
    containerRMS.style.display = 'block';
    container2D.style.display = 'none';
    legendRMS.style.display = 'flex';
    legend2D.style.display = 'none';
    visualizerTitle.textContent = 'Timeline Noise Floor & Dynamics';
    redrawActiveTimelineOrMap();
  });

  tabTimeline2D.addEventListener('click', () => {
    state.visualizerTab = '2d';
    tabTimeline2D.classList.add('active');
    tabTimelineRMS.classList.remove('active');
    containerRMS.style.display = 'none';
    container2D.style.display = 'block';
    legendRMS.style.display = 'none';
    legend2D.style.display = 'flex';
    visualizerTitle.textContent = '2D Attenuation & Transient Bypass Map';
    redrawActiveTimelineOrMap();
  });

  // WAV Export
  btnConfirmExport.addEventListener('click', async () => {
    const targetMode = exportTargetMode.value as 'denoised' | 'highs-clean' | 'delta';
    const bitDepth = (parseInt(exportBitDepth.value, 10) || 24) as 16 | 24 | 32;
    const targetRateStr = exportSampleRate.value;
    const targetRate: 'source' | number = targetRateStr === 'source' ? 'source' : parseInt(targetRateStr, 10);

    let sourceBuffer = state.denoisedBuffer;
    if (targetMode === 'delta') {
      sourceBuffer = state.deltaBuffer;
    } else if (targetMode === 'highs-clean') {
      sourceBuffer = state.highsCleanBuffer || state.denoisedBuffer;
    }
    if (!sourceBuffer) return;

    progressContainer.style.display = 'flex';
    progressStatusText.textContent = 'Rendering and exporting WAV file...';
    progressPercentText.textContent = '100%';
    progressBarFill.style.width = '100%';

    try {
      const options: ExportOptions = {
        targetMode,
        bitDepth,
        targetSampleRate: targetRate
      };
      await exportWavFile(sourceBuffer, options, state.rawFileName);
    } catch (err) {
      console.error('Export failed', err);
      alert('WAVエクスポートに失敗しました: ' + (err as Error).message);
    } finally {
      progressContainer.style.display = 'none';
    }
  });

  // Resize Handler
  window.addEventListener('resize', () => {
    redrawActiveTimelineOrMap();
    drawSpectrum(
      canvasSpectrum,
      player.getAnalyser(),
      player.isPlaying,
      state.rawBuffer,
      state.params.cutoffHz,
      state.activeMonitoringMode
    );
  });
}

// --- Initialize ---
setupEventListeners();
renderVisualizerLoop();
redrawActiveTimelineOrMap();
drawSpectrum(canvasSpectrum, null, false, null, state.params.cutoffHz, state.activeMonitoringMode);
