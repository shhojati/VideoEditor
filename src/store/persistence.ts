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

interface EditorDB extends DBSchema {
  projects: { key: ID; value: StoredProject; indexes: { updatedAt: number } };
  meta: { key: string; value: unknown };
}

const DB_NAME = 'video-editor';
let dbPromise: Promise<IDBPDatabase<EditorDB>> | null = null;

function db() {
  dbPromise ??= openDB<EditorDB>(DB_NAME, 1, {
    upgrade(d) {
      d.createObjectStore('projects', { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
      d.createObjectStore('meta');
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

export async function getLastProjectId(): Promise<ID | undefined> {
  return (await (await db()).get('meta', 'lastProjectId')) as ID | undefined;
}

export async function setLastProjectId(id: ID): Promise<void> {
  await (await db()).put('meta', id, 'lastProjectId');
}
