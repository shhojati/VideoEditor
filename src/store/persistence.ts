import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ID, Project } from '../model/types';
import { parseProject } from '../model/validate';

export interface ProjectSummary {
  id: ID;
  name: string;
  updatedAt: number;
}

interface StoredProject extends ProjectSummary {
  data: Project;
}

/** Regenerable data computed from an asset's file (thumbnails, waveform). Safe to drop at any time. */
export interface DerivedMedia {
  assetId: ID;
  /** Filmstrip frames (JPEG) and the source times they were taken at. */
  thumbs?: { times: number[]; blobs: Blob[]; width: number; height: number };
  /** Min/max pairs, see lib/peaks.ts. */
  waveform?: { peaksPerSecond: number; peaks: Float32Array };
  /** Background noise spectrum for noise reduction (engine/audio/cleanDsp.ts), made on demand. */
  noise?: Float32Array;
}

interface EditorDB extends DBSchema {
  projects: { key: ID; value: StoredProject; indexes: { updatedAt: number } };
  meta: { key: string; value: unknown };
  derived: { key: ID; value: DerivedMedia };
}

const DB_NAME = 'video-editor';
let dbPromise: Promise<IDBPDatabase<EditorDB>> | null = null;

function db() {
  dbPromise ??= openDB<EditorDB>(DB_NAME, 2, {
    upgrade(d, oldVersion) {
      if (oldVersion < 1) {
        d.createObjectStore('projects', { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
        d.createObjectStore('meta');
      }
      if (oldVersion < 2) d.createObjectStore('derived', { keyPath: 'assetId' });
    },
  });
  return dbPromise;
}

/** Tests only: drop the cached connection so a fresh fake IndexedDB can be used. */
export function resetDbForTests() {
  dbPromise = null;
}

export async function saveProject(project: Project, now = Date.now()): Promise<void> {
  await (await db()).put('projects', { id: project.id, name: project.name, updatedAt: now, data: project });
}

/** Loads, migrates and validates a stored project. */
export async function loadProject(id: ID): Promise<Project | null> {
  const rec = await (await db()).get('projects', id);
  return rec ? parseProject(rec.data) : null;
}

/** Most recently edited first. */
export async function listProjects(): Promise<ProjectSummary[]> {
  const all = await (await db()).getAllFromIndex('projects', 'updatedAt');
  return all.reverse().map(({ id, name, updatedAt }) => ({ id, name, updatedAt }));
}

export async function deleteProject(id: ID): Promise<void> {
  await (await db()).delete('projects', id);
}

/** Every asset id referenced by any stored project (read raw, so even unparseable projects keep their media). */
export async function referencedAssetIds(): Promise<Set<ID>> {
  const ids = new Set<ID>();
  for (const rec of await (await db()).getAll('projects')) {
    const assets = (rec.data as { assets?: unknown })?.assets;
    if (assets && typeof assets === 'object') for (const id of Object.keys(assets)) ids.add(id);
  }
  return ids;
}

export async function getDerived(assetId: ID): Promise<DerivedMedia | undefined> {
  return (await db()).get('derived', assetId);
}

export async function putDerived(value: DerivedMedia): Promise<void> {
  await (await db()).put('derived', value);
}

export async function listDerivedIds(): Promise<ID[]> {
  return (await db()).getAllKeys('derived');
}

export async function deleteDerived(assetId: ID): Promise<void> {
  await (await db()).delete('derived', assetId);
}

export async function getLastProjectId(): Promise<ID | undefined> {
  return (await (await db()).get('meta', 'lastProjectId')) as ID | undefined;
}

export async function setLastProjectId(id: ID): Promise<void> {
  await (await db()).put('meta', id, 'lastProjectId');
}
