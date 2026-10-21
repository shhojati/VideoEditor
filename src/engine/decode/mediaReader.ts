// One open handle per asset for playback: a Mediabunny Input on the OPFS file with video/audio sinks,
// or a decoded bitmap for images. WebCodecs decodes off the main thread; the JS here only demuxes.
import { ALL_FORMATS, AudioBufferSink, BlobSource, Input, VideoSampleSink } from 'mediabunny';
import { getMediaFile } from '../../lib/opfs';
import type { Asset, ID } from '../../model/types';
import type { Drawable } from '../render/renderFrame';
import { bitmapDrawable, decodeAnimated, frameIndexAt, type AnimatedImage } from './animatedImage';

export class MediaReader {
  private constructor(
    readonly asset: Asset,
    private readonly input: Input | null,
    readonly video: VideoSampleSink | null,
    readonly audio: AudioBufferSink | null,
    readonly image: Drawable | null,
    private readonly bitmap: ImageBitmap | null,
    private readonly animation: { image: AnimatedImage; drawables: Drawable[] } | null = null,
  ) {}

  /** The image to show at source time t (s): the right frame of an animated image, else the still. */
  imageAt(t: number): Drawable | null {
    if (!this.animation) return this.image;
    const { image, drawables } = this.animation;
    return drawables[frameIndexAt(image.starts, image.duration, t)];
  }

  static async open(asset: Asset): Promise<MediaReader | null> {
    const file = asset.fileRef.opfsPath ? await getMediaFile(asset.fileRef.opfsPath) : null;
    if (!file) return null;
    if (asset.kind === 'image') {
      const animated = await decodeAnimated(file).catch(() => null);
      if (animated) {
        const drawables = animated.frames.map(bitmapDrawable);
        return new MediaReader(asset, null, null, null, drawables[0], null, { image: animated, drawables });
      }
      const bmp = await createImageBitmap(file);
      return new MediaReader(asset, null, null, null, bitmapDrawable(bmp), bmp);
    }
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    const [v, a] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()]);
    const video = v && asset.kind === 'video' && (await v.canDecode()) ? new VideoSampleSink(v) : null;
    const audio = a && (await a.canDecode()) ? new AudioBufferSink(a) : null;
    return new MediaReader(asset, input, video, audio, null, null);
  }

  dispose() {
    this.input?.dispose();
    this.bitmap?.close();
    this.animation?.image.frames.forEach((f) => f.close());
  }
}

/** Shared registry: readers open lazily and stay open while their asset is in the project. */
class ReaderRegistry {
  private readonly opening = new Map<ID, Promise<MediaReader | null>>();
  private readonly ready = new Map<ID, MediaReader>();
  /** Called whenever a reader finishes opening (so a frame can be redrawn). */
  onReady: () => void = () => {};

  /** The reader if it is open; otherwise starts opening it and returns undefined. */
  peek(asset: Asset): MediaReader | undefined {
    const r = this.ready.get(asset.id);
    if (r) return r;
    void this.get(asset);
    return undefined;
  }

  get(asset: Asset): Promise<MediaReader | null> {
    let p = this.opening.get(asset.id);
    if (!p) {
      p = MediaReader.open(asset)
        .then((r) => {
          if (r && this.opening.get(asset.id) === p) {
            this.ready.set(asset.id, r);
            this.onReady();
          }
          return r;
        })
        .catch((e) => {
          console.warn('could not open media', asset.name, e);
          return null;
        });
      this.opening.set(asset.id, p);
    }
    return p;
  }

  /** Close readers for assets that are no longer in the project (or all). */
  retain(ids: ReadonlySet<ID> | null) {
    for (const [id, r] of this.ready) {
      if (ids?.has(id)) continue;
      r.dispose();
      this.ready.delete(id);
      this.opening.delete(id);
    }
    for (const id of [...this.opening.keys()]) if (!ids?.has(id) && !this.ready.has(id)) this.opening.delete(id);
  }
}

export const readers = new ReaderRegistry();
