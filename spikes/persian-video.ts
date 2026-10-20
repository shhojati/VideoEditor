// Test fixture: a ~2-minute "talking" MP4 with real Persian speech (12 Common Voice clips from
// public/spike-data, repeated) and simple frames, for exercising automatic subtitles end to end.
import { AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output, QUALITY_MEDIUM } from 'mediabunny';

export async function makePersianTestVideo(repeats = 2, gap = 0.6): Promise<{ blob: Blob; duration: number; transcript: string[] }> {
  const rate = 48_000;
  const ac = new AudioContext({ sampleRate: rate });
  const clips: AudioBuffer[] = [];
  for (let i = 0; i < 12; i++) clips.push(await ac.decodeAudioData(await (await fetch(`/spike-data/s${i}.mp3`)).arrayBuffer()));
  await ac.close();
  const transcript: string[] = await (await fetch('/spike-data/ref.json')).json();

  const parts = Array.from({ length: repeats }, () => clips).flat();
  const total = parts.reduce((n, b) => n + b.length + gap * rate, 0);
  const audio = new AudioBuffer({ length: total, numberOfChannels: 1, sampleRate: rate });
  const data = audio.getChannelData(0);
  let o = Math.round(gap * rate);
  for (const b of parts) {
    data.set(b.getChannelData(0), o);
    o += b.length + Math.round(gap * rate);
  }
  const duration = total / rate;

  const fps = 25;
  const canvas = new OffscreenCanvas(960, 540);
  const ctx = canvas.getContext('2d')!;
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const video = new CanvasSource(canvas, { codec: 'avc', bitrate: QUALITY_MEDIUM });
  const sound = new AudioBufferSource({ codec: 'aac', bitrate: 96_000 });
  output.addVideoTrack(video, { frameRate: fps });
  output.addAudioTrack(sound);
  await output.start();
  await sound.add(audio);
  for (let n = 0; n < duration * fps; n++) {
    const t = n / fps;
    ctx.fillStyle = '#2d3b55';
    ctx.fillRect(0, 0, 960, 540);
    ctx.fillStyle = '#f2c38b';
    ctx.beginPath();
    ctx.arc(480, 230, 110 + 8 * Math.sin(t * 9), 0, Math.PI * 2); // a "speaker"
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '28px sans-serif';
    ctx.fillText(`${t.toFixed(1)}s`, 20, 40);
    await video.add(t, 1 / fps);
  }
  await output.finalize();
  return { blob: new Blob([output.target.buffer!], { type: 'video/mp4' }), duration, transcript };
}
