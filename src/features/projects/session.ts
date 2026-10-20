// Project lifecycle: what is open, creating, switching, renaming and deleting projects.
import { create } from 'zustand';
import { createProject, type AspectPreset } from '../../model/factories';
import type { ID } from '../../model/types';
import { gcMedia } from '../../store/mediaGc';
import * as db from '../../store/persistence';
import { useProjectStore } from '../../store/projectStore';

interface ProjectListState {
  projects: db.ProjectSummary[];
  /** Set when the last project failed to load (corrupt / newer version). */
  loadError?: string;
}

export const useProjectList = create<ProjectListState>()(() => ({ projects: [] }));

export async function refreshList() {
  useProjectList.setState({ projects: await db.listProjects() });
}

async function open(project: Parameters<typeof db.saveProject>[0]) {
  useProjectStore.getState().load(project);
  await db.setLastProjectId(project.id);
  await refreshList();
}

export async function newProject(name: string, aspect: AspectPreset = '16:9') {
  const project = createProject(name, aspect);
  await db.saveProject(project);
  await open(project);
}

export async function openProject(id: ID) {
  try {
    const project = await db.loadProject(id);
    if (!project) throw new Error('Project not found');
    useProjectList.setState({ loadError: undefined });
    await open(project);
  } catch (e) {
    useProjectList.setState({ loadError: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

export function renameProject(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return;
  useProjectStore.getState().edit('ops.rename', (p) => {
    p.name = trimmed;
  });
}

export async function deleteProject(id: ID, fallbackName: string) {
  await db.deleteProject(id);
  await refreshList();
  if (useProjectStore.getState().history?.present.id !== id) return;
  const next = useProjectList.getState().projects[0];
  if (next) await openProject(next.id);
  else await newProject(fallbackName);
}

let booting: Promise<void> | null = null;

/**
 * On startup: reopen the last project, else the most recent one, else create a fresh one.
 * Idempotent while running, so StrictMode's double effect cannot create two projects.
 */
export function bootstrap(defaultName: string): Promise<void> {
  booting ??= doBootstrap(defaultName).finally(() => (booting = null));
  return booting;
}

async function doBootstrap(defaultName: string) {
  try {
    await gcMedia();
  } catch (e) {
    console.warn('media cleanup skipped', e); // e.g. OPFS unavailable; never block startup
  }
  await refreshList();
  const candidates = [await db.getLastProjectId(), ...useProjectList.getState().projects.map((p) => p.id)];
  let firstError: string | undefined;
  for (const id of new Set(candidates)) {
    if (!id) continue;
    try {
      await openProject(id);
      break;
    } catch {
      // try the next one, but remember why so the UI can tell the user
      firstError ??= useProjectList.getState().loadError;
    }
  }
  if (!useProjectStore.getState().history) await newProject(defaultName);
  if (firstError) useProjectList.setState({ loadError: firstError });
}
