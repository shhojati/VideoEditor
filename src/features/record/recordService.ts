// Voiceover (and optional webcam) recording. The preview plays from the playhead while the mic is
// recorded, so the take lines up with the picture; on stop the recording is imported like any
// other file and placed on a new track at the time recording started.
import { create } from 'zustand';
import { useTransport } from '../../store/transport';
import { importFileAs } from '../media-bin/mediaService';
import { placeAssetAt } from '../timeline/interactions';

export type RecordStage = 'closed' | 'setup' | 'countdown' | 'recording' | 'saving';
export type RecordError = 'denied' | 'noDevice' | 'failed';

interface RecordState {
  stage: RecordStage;
  /** Seconds left in the 3-2-1 countdown. */
  countdown: number;
  /** Seconds recorded so far. */
  elapsed: number;
  /** Mic level 0..1 for the meter. */
  level: number;
  camera: boolean;
  /** Silence the timeline while recording (headphones not needed). */
  muteTimeline: boolean;
  micId?: string;
  camId?: string;
  mics: { id: string; label: string }[];
  cams: { id: string; label: string }[];
  stream?: MediaStream;
  error?: RecordError;
  /** How many takes this session, for file names. */
  takes: number;
}

export const useRecord = create<RecordState>()(() => ({
  stage: 'closed',
  countdown: 0,
  elapsed: 0,
  level: 0,
  camera: false,
  muteTimeline: true,
  mics: [],
  cams: [],
  takes: 0,
}));

const COUNTDOWN = 3;

/**
 * Created in the click that opens the recorder: made later (after the permission prompt) Chrome
 * may start it suspended, and the meter would stay at zero.
 */
let meterCtx: AudioContext | null = null;
let meter: { source: MediaStreamAudioSourceNode; raf: number } | null = null;
let recorder: MediaRecorder | null = null;
let timer = 0;
let restoreVolume: number | null = null;

function stopMeter() {
  if (!meter) return;
  cancelAnimationFrame(meter.raf);
  meter.source.disconnect();
  meter = null;
}

function startMeter(stream: MediaStream) {
  stopMeter();
  if (!meterCtx) return;
  void meterCtx.resume();
  const analyser = meterCtx.createAnalyser();
  analyser.fftSize = 1024;
  const source = meterCtx.createMediaStreamSource(stream);
  source.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  const tick = () => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    // RMS on a dB-ish scale: -60 dB → 0, 0 dB → 1.
    const db = 10 * Math.log10(sum / buf.length + 1e-12);
    useRecord.setState({ level: Math.max(0, Math.min(1, (db + 60) / 60)) });
    meter!.raf = requestAnimationFrame(tick);
  };
  meter = { source, raf: requestAnimationFrame(tick) };
}

function releaseStream() {
  stopMeter();
  useRecord.getState().stream?.getTracks().forEach((t) => t.stop());
  useRecord.setState({ stream: undefined, level: 0 });
}

function errorOf(e: unknown): RecordError {
  const name = e instanceof DOMException ? e.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'noDevice';
  return 'failed';
}

/** (Re)open the mic, and the camera if chosen, for the level meter and camera preview. */
async function openStream() {
  releaseStream();
  const { camera, micId, camId } = useRecord.getState();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: micId ? { exact: micId } : undefined, echoCancellation: true, noiseSuppression: true },
      video: camera ? { deviceId: camId ? { exact: camId } : undefined, width: { ideal: 1280 }, height: { ideal: 720 } } : false,
    });
    if (useRecord.getState().stage === 'closed') {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    // Device names are only readable once permission is granted.
    const devices = await navigator.mediaDevices.enumerateDevices();
    const list = (kind: MediaDeviceKind) =>
      devices.filter((d) => d.kind === kind && d.deviceId).map((d, i) => ({ id: d.deviceId, label: d.label || `${kind} ${i + 1}` }));
    useRecord.setState({ stream, error: undefined, mics: list('audioinput'), cams: list('videoinput') });
    startMeter(stream);
  } catch (e) {
    useRecord.setState({ error: errorOf(e) });
  }
}

export function openRecorder() {
  if (useRecord.getState().stage !== 'closed') return;
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    useRecord.setState({ stage: 'setup', error: 'failed' });
    return;
  }
  useRecord.setState({ stage: 'setup', error: undefined });
  meterCtx ??= new AudioContext();
  void openStream();
}

export function closeRecorder() {
  const { stage } = useRecord.getState();
  if (stage === 'recording' || stage === 'saving') return;
  clearInterval(timer);
  releaseStream();
  void meterCtx?.close();
  meterCtx = null;
  useRecord.setState({ stage: 'closed', countdown: 0 });
}

export function setRecordOptions(patch: Partial<Pick<RecordState, 'camera' | 'micId' | 'camId' | 'muteTimeline'>>) {
  const before = useRecord.getState();
  useRecord.setState(patch);
  const reopen = (['camera', 'micId', 'camId'] as const).some((k) => k in patch && patch[k] !== before[k]);
  if (reopen && before.stage === 'setup') void openStream();
}

/** Container and codecs MediaRecorder supports here; WebM with Opus (and VP9) in Chrome. */
export function recordingMime(camera: boolean) {
  const candidates = camera
    ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
    : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
}

/** 3-2-1, then record. */
export function startRecording() {
  const { stage, stream } = useRecord.getState();
  if (stage !== 'setup' || !stream) return;
  useRecord.setState({ stage: 'countdown', countdown: COUNTDOWN });
  clearInterval(timer);
  timer = window.setInterval(() => {
    const left = useRecord.getState().countdown - 1;
    if (left > 0) {
      useRecord.setState({ countdown: left });
      return;
    }
    clearInterval(timer);
    begin(stream);
  }, 1000);
}

function begin(stream: MediaStream) {
  const { camera, muteTimeline } = useRecord.getState();
  const mime = recordingMime(camera);
  const chunks: Blob[] = [];
  let startTime = 0;
  let startedAt = 0;
  try {
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  } catch (e) {
    useRecord.setState({ stage: 'setup', error: errorOf(e) });
    return;
  }
  const rec = recorder;
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.onstart = () => {
    // The transport time is what the user hears (latency compensated). The mic adds its own
    // input latency, so the take really started that much earlier on the timeline.
    // (`latency` is in Chrome's settings but not yet in TypeScript's DOM types.)
    const settings = stream.getAudioTracks()[0]?.getSettings() as (MediaTrackSettings & { latency?: number }) | undefined;
    const inputLatency = settings?.latency ?? 0;
    startTime = Math.max(0, useTransport.getState().time - inputLatency);
    startedAt = performance.now();
    useRecord.setState({ stage: 'recording', elapsed: 0 });
    timer = window.setInterval(() => useRecord.setState({ elapsed: (performance.now() - startedAt) / 1000 }), 100);
  };
  rec.onstop = () => void save(new Blob(chunks, { type: rec.mimeType || mime }), startTime);
  if (muteTimeline) {
    restoreVolume = useTransport.getState().volume;
    useTransport.setState({ volume: 0 });
  }
  // Play from the playhead so the take lines up with the picture (an empty timeline just records).
  useTransport.getState().play();
  rec.start(1000);
}

export function stopRecording() {
  if (useRecord.getState().stage !== 'recording' || !recorder) return;
  clearInterval(timer);
  useTransport.getState().pause();
  if (restoreVolume !== null) {
    useTransport.setState({ volume: restoreVolume });
    restoreVolume = null;
  }
  useRecord.setState({ stage: 'saving' });
  recorder.stop();
  recorder = null;
}

async function save(blob: Blob, startTime: number) {
  const { camera, takes } = useRecord.getState();
  const take = takes + 1;
  const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
  const file = new File([blob], `${camera ? 'Camera' : 'Voiceover'} ${take}.${ext}`, { type: blob.type });
  useRecord.setState({ takes: take });
  const assetId = blob.size ? await importFileAs(file, {}) : null;
  // A new track at the recording's start, so it never lands on top of existing clips.
  if (assetId) placeAssetAt(assetId, null, startTime);
  else useRecord.setState({ error: 'failed' });
  useRecord.setState({ stage: 'setup', elapsed: 0 });
}
