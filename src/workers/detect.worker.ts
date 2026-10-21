/// <reference lib="webworker" />
// Auto reframe: finds the main person in a video's frames, a few times a second. YOLOS-tiny (an
// Apache-2.0 object detector, ~10 MB) runs fully offline through transformers.js, with the model
// and ONNX Runtime served from our own origin like the speech-to-text models.
import { AutoModelForObjectDetection, AutoProcessor, env, RawImage, type Tensor } from '@huggingface/transformers';
import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import { getMediaFile } from '../lib/opfs';
import { personTarget, type Detection } from '../model/reframe';

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = '/models/';
env.backends.onnx.wasm!.wasmPaths = {
  mjs: '/wasm/ort-wasm-simd-threaded.asyncify.mjs',
  wasm: '/wasm/ort-wasm-simd-threaded.asyncify.wasm',
} as never;

export const DETECTOR_MODEL = 'Xenova/yolos-tiny';

export interface DetectRequest {
  opfsPath: string;
  /** Source range to analyse and how many frames per second. */
  from: number;
  to: number;
  fps: number;
  device: 'webgpu' | 'wasm';
}

export type DetectMessage =
  | { type: 'loading' }
  | { type: 'progress'; done: number; detections: Detection[] }
  | { type: 'done' }
  | { type: 'error'; message: string };

const post = (m: DetectMessage) => self.postMessage(m);
/** Short side of the analysed frames (px), for decoding and for the detector. */
const WORK_SHORT = 320;

self.onmessage = async (e: MessageEvent<DetectRequest>) => {
  const { opfsPath, from, to, fps, device } = e.data;
  try {
    post({ type: 'loading' });
    // Model and image processor only (the object-detection pipeline would also look for tokenizer files).
    const processor = await AutoProcessor.from_pretrained(DETECTOR_MODEL);
    // People fill much of the frame when reframing: a smaller input is plenty, and much faster.
    Object.assign(processor.image_processor as object, { size: { shortest_edge: WORK_SHORT, longest_edge: WORK_SHORT * 2 } });
    const model = await AutoModelForObjectDetection.from_pretrained(DETECTOR_MODEL, { device, dtype: 'q8' });
    const id2label = (model.config as unknown as { id2label: Record<number, string> }).id2label;
    const detect = async (image: RawImage) => {
      const { pixel_values, pixel_mask } = await processor(image);
      const output = await model({ pixel_values, pixel_mask });
      // YOLOS's image processor has post_process_object_detection (not in the base typings).
      const imageProcessor = processor.image_processor as unknown as { post_process_object_detection: (o: unknown, threshold: number, sizes: number[][]) => unknown };
      const [r] = imageProcessor.post_process_object_detection(output as { logits: Tensor; pred_boxes: Tensor }, 0.5, [[image.height, image.width]]) as {
        boxes: number[][];
        classes: number[];
        scores: number[];
      }[];
      return r.boxes.map((b, i) => ({ label: id2label[r.classes[i]], score: r.scores[i], box: { xmin: b[0], ymin: b[1], xmax: b[2], ymax: b[3] } }));
    };
    const file = await getMediaFile(opfsPath);
    if (!file) throw new Error('missing media');
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track) throw new Error('no video track');
      const k = WORK_SHORT / Math.min(track.displayWidth, track.displayHeight);
      const width = Math.max(1, Math.round(track.displayWidth * k));
      const height = Math.max(1, Math.round(track.displayHeight * k));
      const sink = new CanvasSink(track, { width, height, fit: 'fill', poolSize: 1 });
      const times: number[] = [];
      for (let s = from; s < to; s += 1 / fps) times.push(s);
      let batch: Detection[] = [];
      let i = 0;
      for await (const frame of sink.canvasesAtTimestamps(times)) {
        const s = times[i++];
        if (!frame) {
          batch.push({ s });
          continue;
        }
        const canvas = frame.canvas as OffscreenCanvas;
        const pixels = canvas.getContext('2d')!.getImageData(0, 0, width, height);
        const image = new RawImage(pixels.data, width, height, 4);
        const found = await detect(image);
        // The main person: big and confident.
        let best: (typeof found)[number] | undefined;
        let bestScore = 0;
        for (const d of found) {
          if (d.label !== 'person') continue;
          const area = ((d.box.xmax - d.box.xmin) * (d.box.ymax - d.box.ymin)) / (width * height);
          const score = d.score * Math.sqrt(area);
          if (score > bestScore) {
            bestScore = score;
            best = d;
          }
        }
        if (best) {
          const b = best.box;
          const target = personTarget({ x: b.xmin / width, y: b.ymin / height, w: (b.xmax - b.xmin) / width, h: (b.ymax - b.ymin) / height });
          batch.push({ s, x: target.x, y: target.y });
        } else batch.push({ s });
        if (batch.length >= 8) {
          post({ type: 'progress', done: i / times.length, detections: batch });
          batch = [];
        }
      }
      post({ type: 'progress', done: 1, detections: batch });
      post({ type: 'done' });
    } finally {
      input.dispose();
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
