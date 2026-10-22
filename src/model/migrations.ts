// Versioned migrations for stored project JSON. Bump CURRENT_VERSION and add a step whenever the
// shape of `Project` changes in a way old documents would not satisfy.
import { ellipsePath, rectPath } from './masks';

export const CURRENT_VERSION = 7;

/** migrations[n] upgrades a version-n document to version n+1. */
export type MigrationTable = Record<number, (doc: Record<string, unknown>) => Record<string, unknown>>;

type Doc = Record<string, unknown>;

/** Every clip of a stored document. */
const clipsOf = (doc: Doc): Doc[] =>
  Array.isArray(doc.tracks) ? doc.tracks.flatMap((t: Doc) => (Array.isArray(t?.clips) ? (t.clips as Doc[]) : [])) : [];

export const MIGRATIONS: MigrationTable = {
  // 1 → 2: an adjustment layer's rectangle/ellipse `mask` becomes a roto mask path (`masks`).
  1: (stored) => {
    const doc = structuredClone(stored);
    for (const clip of clipsOf(doc)) {
      const m = clip.mask as { kind?: string; width?: number; height?: number; feather?: number } | undefined;
      delete clip.mask;
      if (!m || !m.width || !m.height) continue;
      const path = m.kind === 'ellipse' ? ellipsePath(0, 0, m.width, m.height) : rectPath(0, 0, m.width, m.height);
      clip.masks = [
        {
          id: `${String(clip.id)}-mask`,
          name: 'Mask 1',
          mode: 'add',
          path: { value: path },
          feather: { value: m.feather ?? 0 },
          expansion: { value: 0 },
          opacity: { value: 1 },
        },
      ];
    }
    return doc;
  },
  // 2 → 3: speed curves, reverse and freeze frames. Nothing to convert; the bump makes older app
  // versions refuse these documents instead of silently dropping the new fields.
  2: (stored) => structuredClone(stored),
  // 3 → 4: compound clips (Project.sequences, Clip.sequenceId). Nothing to convert.
  3: (stored) => structuredClone(stored),
  // 4 → 5: brush strokes (Clip.paint) and paint layers. Nothing to convert.
  4: (stored) => structuredClone(stored),
  // 5 → 6: shapes drawn with the pen (ShapeProps.path). Nothing to convert.
  5: (stored) => structuredClone(stored),
  // 6 → 7: parenting (Clip.parentId), null objects and solid layers. Nothing to convert.
  6: (stored) => structuredClone(stored),
};

export class MigrationError extends Error {}

export function migrate(
  raw: unknown,
  table: MigrationTable = MIGRATIONS,
  target: number = CURRENT_VERSION,
): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null) throw new MigrationError('Project is not an object');
  let doc = raw as Record<string, unknown>;
  let version = typeof doc.version === 'number' ? doc.version : 0;
  if (version > target) throw new MigrationError(`Project version ${version} is newer than this app (${target})`);
  while (version < target) {
    const step = table[version];
    if (!step) throw new MigrationError(`No migration from version ${version}`);
    doc = { ...step(doc), version: version + 1 };
    version++;
  }
  return doc;
}
