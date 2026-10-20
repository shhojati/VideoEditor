// A small sample video generated in the browser (no bundled media needed, works offline): an
// animated gradient with soft shapes and a gentle tone, H.264 + AAC.
import { AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output, QUALITY_MEDIUM, canEncodeAudio } from 'mediabunny';
import { ensureAacEncoder } from '../engine/export/aac';

export async function generateSampleVideo(seconds = 8, width = 1280, height = 720, fps = 30): Promise<File> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const video = new CanvasSource(canvas, { codec: 'avc', bitrate: QUALITY_MEDIUM });
  output.addVideoTrack(video, { frameRate: fps });
  await ensureAacEncoder().catch(() => undefined);
  const aac = await canEncodeAudio('aac');
  const audio = new AudioBufferSource({ codec: aac ? 'aac' : 'opus', bitrate: 96_000 });
  output.addAudioTrack(audio);
  await output.start();

  const rate = 48_000;
  const buf = new AudioBuffer({ length: rate * seconds, numberOfChannels: 2, sampleRate: rate });
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const t = i / rate;
      const env = Math.min(1, t / 0.5, (seconds - t) / 0.5);
      // A soft major chord, slowly pulsing.
      d[i] = env * 0.08 * (1 + 0.3 * Math.sin(t * 2)) * (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 277.2 * t) + Math.sin(2 * Math.PI * 329.6 * t));
    }
  }
  await audio.add(buf);

  for (let n = 0; n < seconds * fps; n++) {
    const t = n / fps;
    const g = ctx.createLinearGradient(0, 0, width, height);
    g.addColorStop(0, `hsl(${200 + 40 * Math.sin(t / 2)} 70% 35%)`);
    g.addColorStop(1, `hsl(${280 + 40 * Math.cos(t / 3)} 60% 25%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
    for (let k = 0; k < 6; k++) {
      ctx.fillStyle = `hsla(${(k * 60 + t * 30) % 360} 80% 70% / 0.25)`;
      ctx.beginPath();
      ctx.arc(width * (0.15 + 0.14 * k) + 40 * Math.sin(t + k), height * 0.5 + 120 * Math.sin(t * 0.8 + k), 60 + 20 * Math.sin(t * 2 + k), 0, Math.PI * 2);
      ctx.fill();
    }
    await video.add(t, 1 / fps);
  }
  await output.finalize();
  return new File([(output.target as BufferTarget).buffer!], 'sample.mp4', { type: 'video/mp4' });
}
