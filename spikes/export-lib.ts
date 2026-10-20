import {
  AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output, QUALITY_HIGH,
  canEncodeAudio, canEncodeVideo,
} from 'mediabunny';

export interface ExportResult { blob: Blob; ms: number; audioCodec: string; log: string[] }

/** Spike 2: render N seconds of generated frames + 440 Hz sine into an H.264/AAC MP4. */
export async function exportTestVideo(seconds = 5, width = 1280, height = 720, fps = 30): Promise<ExportResult> {
  const log: string[] = [];
  const t0 = performance.now();
  const avc = await canEncodeVideo('avc', { width, height });
  const aac = await canEncodeAudio('aac');
  const opus = await canEncodeAudio('opus');
  log.push(`canEncode avc=${avc} aac=${aac} opus=${opus}`);
  if (!avc) throw new Error('H.264 encoding not supported');
  const audioCodec = aac ? 'aac' : 'opus';

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const video = new CanvasSource(canvas, { codec: 'avc', bitrate: QUALITY_HIGH });
  const audio = new AudioBufferSource({ codec: audioCodec, bitrate: 128_000 });
  output.addVideoTrack(video, { frameRate: fps });
  output.addAudioTrack(audio);
  await output.start();

  const sampleRate = 48_000;
  const buf = new AudioBuffer({ length: sampleRate * seconds, numberOfChannels: 2, sampleRate });
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
  }
  await audio.add(buf);

  for (let n = 0; n < seconds * fps; n++) {
    const t = n / fps;
    ctx.fillStyle = `hsl(${(t * 72) % 360} 60% 30%)`;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 96px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`frame ${n}  t=${t.toFixed(2)}s`, width / 2, height / 2);
    ctx.fillRect((t / seconds) * width, height - 40, 20, 40);
    await video.add(t, 1 / fps);
  }
  await output.finalize();
  const blob = new Blob([(output.target as BufferTarget).buffer!], { type: 'video/mp4' });
  const ms = performance.now() - t0;
  log.push(`exported ${seconds}s ${width}x${height}@${fps} in ${ms.toFixed(0)} ms, ${(blob.size / 1e6).toFixed(2)} MB, audio=${audioCodec}`);
  return { blob, ms, audioCodec, log };
}
