import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import * as db from '../../store/persistence';
import { useProjectStore } from '../../store/projectStore';
import { startAutosave, useSaveStatus } from '../../store/autosave';
import { bootstrap, deleteProject, newProject, renameProject, useProjectList } from './session';

const current = () => useProjectStore.getState().history?.present;

async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeout) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory(); // fresh database per test
  db.resetDbForTests();
  useProjectStore.setState({ history: null });
  useProjectList.setState({ projects: [], loadError: undefined });
});

describe('project session', () => {
  it('creates a project on first start', async () => {
    await bootstrap('Untitled');
    expect(current()?.name).toBe('Untitled');
    expect(await db.listProjects()).toHaveLength(1);
  });

  it('creates only one project when started twice concurrently (StrictMode)', async () => {
    await Promise.all([bootstrap('Untitled'), bootstrap('Untitled')]);
    expect(await db.listProjects()).toHaveLength(1);
  });

  it('restores the last opened project after a reload', async () => {
    await newProject('First');
    await newProject('Second');
    const id = current()!.id;

    useProjectStore.setState({ history: null }); // simulate page reload
    await bootstrap('Untitled');
    expect(current()?.id).toBe(id);
    expect(current()?.name).toBe('Second');
  });

  it('autosaves edits so they survive a reload', async () => {
    const stop = startAutosave(0);
    await newProject('Draft');
    renameProject('Renamed');
    useProjectStore.getState().edit('fps', (p) => void (p.settings.fps = 60));
    await waitFor(() => useSaveStatus.getState().status === 'saved');
    stop();

    useProjectStore.setState({ history: null });
    await bootstrap('Untitled');
    expect(current()).toMatchObject({ name: 'Renamed', settings: { fps: 60 } });
  });

  it('falls back to another project when the current one is deleted', async () => {
    await newProject('Keep');
    await newProject('Remove');
    await deleteProject(current()!.id, 'Untitled');
    expect(current()?.name).toBe('Keep');

    await deleteProject(current()!.id, 'Untitled');
    expect(current()?.name).toBe('Untitled');
    expect(await db.listProjects()).toHaveLength(1);
  });

  it('skips a corrupt project and reports the error', async () => {
    await newProject('Good');
    const goodId = current()!.id;
    const bad = { ...current()!, id: 'bad', settings: { width: 'x' } };
    await db.saveProject(bad as never, Date.now() + 1000);
    await db.setLastProjectId('bad');

    useProjectStore.setState({ history: null });
    await bootstrap('Untitled');
    expect(current()?.id).toBe(goodId);
    expect(useProjectList.getState().loadError).toMatch(/Invalid project/);
  });
});
