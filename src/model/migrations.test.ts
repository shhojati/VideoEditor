import { describe, expect, it } from 'vitest';
import { migrate, MigrationError, type MigrationTable } from './migrations';

describe('migrate', () => {
  const table: MigrationTable = {
    1: (d) => ({ ...d, subtitleTracks: [] }),
    2: (d) => ({ ...d, name: String(d.title), title: undefined }),
  };

  it('runs every step from the stored version up to the target', () => {
    const out = migrate({ version: 1, title: 'x' }, table, 3);
    expect(out).toMatchObject({ version: 3, name: 'x', subtitleTracks: [] });
  });

  it('leaves current documents untouched', () => {
    const doc = { version: 3, name: 'y' };
    expect(migrate(doc, table, 3)).toBe(doc);
  });

  it('rejects documents from a newer app', () => {
    expect(() => migrate({ version: 4 }, table, 3)).toThrow(MigrationError);
  });

  it('rejects gaps and non-objects', () => {
    expect(() => migrate({ version: 0 }, table, 3)).toThrow(/No migration from version 0/);
    expect(() => migrate(null, table, 3)).toThrow(MigrationError);
  });
});
