// Reverse: a reversed copy of a source range [from, to], so a reversed clip is just a clip of this
// media played forward (preview, export, speed ramps and audio all keep their normal paths). Source
// time s is at time to − s in the copy. Video is decoded one keyframe group at a time from the end
// (at most WINDOW frames held), re-encoded in reverse order with short keyframe intervals; audio is
// reversed as PCM. Runs in the media worker.
import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSink,
  AudioSampleSource,
  BlobSource,
  BufferTarget,
  canEncodeVideo,
  EncodedPacketSink,
  Input,
  MovOutputFormat,
  Output,
  QUALITY_VERY_HIGH,
  VideoSample,
  VideoSampleSink,
  VideoSampleSource,
  WavOutputFormat,
  type InputAudioTrack,
  type InputVideoTrack,
} from 'mediabunny';

/** Decoded frames held at once (1080p I420: ~3 MB each). */
const WINDOW = 60;
const EPS = 1e-6;

interface HeldFrame {
  data: Uint8Array;
  format: NonNullable<VideoSample['format']>;
  codedWidth: number;
  codedHeight: number;
  timestamp: number;
  duration: number;
}

async function hold(s: VideoSample): Promise<HeldFrame> {
  // Frames without a CPU pixel format (GPU-backed) are read back as RGBA.
  const options = s.format ? undefined : ({ format: 'RGBA' } as const);
  const data = new Uint8Array(s.allocationSize(options));
  await s.copyTo(data, options);
  return {
    data,
    format: s.format ?? 'RGBA',
    codedWidth: s.format ? s.codedWidth : s.displayWidth,
    codedHeight: s.format ? s.codedHeight : s.displayHeight,
    timestamp: s.timestamp,
    duration: s.duration,
  };
}

async function reverseVideo(track: InputVideoTrack, from: number, to: number, out: VideoSampleSource, progress: (f: number) => void) {
  const frames = new VideoSampleSink(track);
  const packets = new EncodedPacketSink(track);
  let segEnd = to;
  while (segEnd > from + EPS) {
    // The keyframe group that contains the frame just before segEnd.
    const key = await packets.getKeyPacket(segEnd - EPS);
    const k = key?.timestamp ?? 0;
    const segStart = Math.max(from, k);
    // Long groups are decoded more than once, a window of frames from the end each time.
    let windowEnd = segEnd;
    while (windowEnd > segStart + EPS) {
      const held: HeldFrame[] = [];
      for await (const s of frames.samples(k, windowEnd)) {
        const keep = s.timestamp < windowEnd - EPS && s.timestamp + s.duration > segStart + EPS;
        if (keep) {
          held.push(await hold(s));
          if (held.length > WINDOW) held.shift();
        }
        s.close();
      }
      if (!held.length) break;
      for (let i = held.length - 1; i >= 0; i--) {
        const f = held[i];
        const start = Math.max(f.timestamp, from);
        const end = Math.min(f.timestamp + f.duration, to);
        const sample = new VideoSample(f.data, {
          format: f.format,
          codedWidth: f.codedWidth,
          codedHeight: f.codedHeight,
          timestamp: Math.max(0, to - end),
          duration: Math.max(1e-3, end - start),
        });
        await out.add(sample);
        sample.close();
      }
      windowEnd = held[0].timestamp;
      progress((to - Math.max(from, windowEnd)) / (to - from));
    }
    if (!key || k <= from + EPS) break;
    segEnd = k;
  }
}

async function reverseAudio(track: InputAudioTrack, from: number, to: number, out: AudioSampleSource) {
  const parts: Float32Array[][] = [];
  let rate = 48_000;
  let channels = 1;
  let first = from;
  for await (const s of new AudioSampleSink(track).samples(from, to)) {
    if (!parts.length) first = s.timestamp;
    rate = s.sampleRate;
    channels = Math.min(2, s.numberOfChannels);
    parts.push(
      Array.from({ length: channels }, (_, c) => {
        const plane = new Float32Array(s.numberOfFrames);
        s.copyTo(plane, { planeIndex: c, format: 'f32-planar' });
        return plane;
      }),
    );
    s.close();
  }
  if (!parts.length) return;
  // Exactly [from, to): trim what the first and last decoded chunks hold beyond it.
  const total = parts.reduce((n, p) => n + p[0].length, 0);
  const skip = Math.max(0, Math.round((from - first) * rate));
  const length = Math.max(0, Math.min(total - skip, Math.round((to - from) * rate)));
  const planes = Array.from({ length: channels }, (_, c) => {
    const all = new Float32Array(total);
    let o = 0;
    for (const p of parts) {
      all.set(p[c] ?? p[0], o);
      o += p[0].length;
    }
    return all.subarray(skip, skip + length).reverse();
  });
  const chunk = rate;
  for (let i = 0; i < length; i += chunk) {
    const n = Math.min(chunk, length - i);
    const data = new Float32Array(n * channels);
    planes.forEach((plane, c) => data.set(plane.subarray(i, i + n), c * n));
    const sample = new AudioSample({ data, format: 'f32-planar', numberOfChannels: channels, sampleRate: rate, timestamp: i / rate });
    await out.add(sample);
    sample.close();
  }
}

/**
 * Reversed copy of [from, to] of a media file: MOV (H.264 or VP9 + PCM) for video, WAV for audio.
 * `progress` gets 0..1 while video frames are written.
 */
export async function reverseMedia(file: Blob, from: number, to: number, progress: (f: number) => void = () => {}): Promise<{ blob: Blob; ext: 'mov' | 'wav' }> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    const target = new BufferTarget();
    const output = new Output({ format: video ? new MovOutputFormat() : new WavOutputFormat(), target });
    let videoOut: VideoSampleSource | undefined;
    if (video) {
      const size = { width: video.codedWidth, height: video.codedHeight };
      const codec = (await canEncodeVideo('avc', size)) ? 'avc' : 'vp9';
      videoOut = new VideoSampleSource({ codec, bitrate: QUALITY_VERY_HIGH, keyFrameInterval: 0.5 });
      output.addVideoTrack(videoOut, { rotation: video.rotation });
    }
    let audioOut: AudioSampleSource | undefined;
    if (audio) {
      audioOut = new AudioSampleSource({ codec: 'pcm-s16' });
      output.addAudioTrack(audioOut);
    }
    await output.start();
    if (video && videoOut) await reverseVideo(video, from, to, videoOut, progress);
    if (audio && audioOut) await reverseAudio(audio, from, to, audioOut);
    await output.finalize();
    const type = video ? 'video/quicktime' : 'audio/wav';
    return { blob: new Blob([target.buffer!], { type }), ext: video ? 'mov' : 'wav' };
  } finally {
    input.dispose();
  }
}
