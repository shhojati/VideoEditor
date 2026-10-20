// Versioned migrations for stored project JSON. Bump CURRENT_VERSION and add a step whenever the
// shape of `Project` changes in a way old documents would not satisfy.

export const CURRENT_VERSION = 1;

/** migrations[n] upgrades a version-n document to version n+1. */
export type MigrationTable = Record<number, (doc: Record<string, unknown>) => Record<string, unknown>>;

export const MIGRATIONS: MigrationTable = {};

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
