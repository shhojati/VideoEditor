// Audio data the main thread prepares for a project and hands to both the preview audio engine
// and the export worker, so both apply exactly the same processing.
import type { ID } from '../../model/types';
import type { NoiseProfile } from './cleanDsp';
import type { DuckPlan } from './ducking';

export interface AudioAux {
  /** Auto-ducking intervals per ducked clip (engine/audio/ducking.ts). */
  duck?: DuckPlan;
  /** Noise profiles per asset, for clips with noise reduction (engine/audio/cleanDsp.ts). */
  noise?: Record<ID, NoiseProfile>;
}
