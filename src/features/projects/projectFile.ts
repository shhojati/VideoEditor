// Project files on disk, to keep or move a project outside the browser:
// - `.vproj`: the project document as JSON. Media stays where it is; on another browser the files
//   show as missing and are relinked with "Choose file".
// - `.vprojz`: a stored (uncompressed) ZIP with `project.json` plus every media file (and uploaded font), so the
//   project opens anywhere as it was.
// Opening either kind adds the project as a new copy (new id), so nothing existing is overwritten.
import { create } from 'zustand';
import { newId } from '../../model/factories';
import type { ID, Project } from '../../model/types';
import { parseProject } from '../../model/validate';
import { getMediaFile, hasRoomFor, mediaPathFor, writeMediaFile } from '../../lib/opfs';
import { readZip, ZipWriter, type ZipSink } from '../../lib/zip';
import * as db from '../../store/persistence';
import { safeFileName } from '../export/exportService';
import { openProject } from './session';

export const PROJECT_EXT = '.vproj';
export const BUNDLE_EXT = '.vprojz';
const FORMAT = 'video-editor-project';
const FORMAT_VERSION = 1;
const PROJECT_ENTRY = 'project.json';

interface ProjectFileDoc {
  format: typeof FORMAT;
  formatVersion: number;
  savedAt: string;
  project: Project;
  /** Bundles only: asset id → archive entry holding its file. */
  media?: Record<ID, string>;
}

export class ProjectFileError extends Error {}

interface TaskState {
  task: { kind: 'save' | 'open'; progress: number } | null;
}
/** The running save/open, for the progress shown next to the project menu. */
export const useProjectFileTask = create<TaskState>()(() => ({ task: null }));

export function serializeProject(project: Project, media?: Record<ID, string>): string {
  const doc: ProjectFileDoc = { format: FORMAT, formatVersion: FORMAT_VERSION, savedAt: new Date().toISOString(), project, ...(media && { media }) };
  return JSON.stringify(doc, null, 2);
}

/** Validate a project file's JSON; the project is migrated to the current version. */
export function parseProjectFile(text: string): { project: Project; media: Record<ID, string> } {
  let doc: Partial<ProjectFileDoc>;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new ProjectFileError('not a project file');
  }
  if (doc?.format !== FORMAT || typeof doc.formatVersion !== 'number') throw new ProjectFileError('not a project file');
  if (doc.formatVersion > FORMAT_VERSION) throw new ProjectFileError(`made by a newer version (format ${doc.formatVersion})`);
  return { project: parseProject(doc.project), media: doc.media ?? {} };
}

type SavePicker = (o: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<FileSystemFileHandle>;

/**
 * Where the file goes: the save dialog when the browser has one, otherwise a download built in
 * memory from the parts (large Blob parts such as media files stay on disk). Null = cancelled.
 * Call it first in the click handler: the dialog needs the user gesture.
 */
async function pickTarget(name: string, ext: string, description: string) {
  const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({ suggestedName: name, types: [{ description, accept: { 'application/octet-stream': [ext] } }] });
      const writable = await handle.createWritable();
      return { sink: ((part) => writable.write(part as Blob)) as ZipSink, done: () => writable.close(), fail: () => writable.abort() };
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return null;
      // No dialog here (e.g. automation): fall back to a download.
    }
  }
  const parts: (Blob | Uint8Array)[] = [];
  return {
    sink: ((part) => void parts.push(part)) as ZipSink,
    done: async () => {
      const url = URL.createObjectURL(new Blob(parts as BlobPart[], { type: 'application/octet-stream' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    fail: async () => {},
  };
}

/**
 * Save the project as `.vproj` (JSON) or, `withMedia`, as a `.vprojz` bundle. Returns the asset
 * ids whose files were not available to include (bundles only), or null when cancelled.
 */
export async function saveProjectFile(project: Project, withMedia: boolean): Promise<ID[] | null> {
  const ext = withMedia ? BUNDLE_EXT : PROJECT_EXT;
  const target = await pickTarget(`${safeFileName(project.name)}${ext}`, ext, withMedia ? 'Video editor project with media' : 'Video editor project');
  if (!target) return null;
  useProjectFileTask.setState({ task: { kind: 'save', progress: 0 } });
  try {
    if (!withMedia) {
      await target.sink(new TextEncoder().encode(serializeProject(project)));
      await target.done();
      return [];
    }
    const files: { id: ID; file: File; entry: string }[] = [];
    const missing: ID[] = [];
    for (const asset of Object.values(project.assets)) {
      const file = await getMediaFile(asset.fileRef.opfsPath ?? mediaPathFor(asset.id));
      if (file) files.push({ id: asset.id, file, entry: `media/${asset.id}-${safeFileName(asset.name)}` });
      else missing.push(asset.id);
    }
    // Uploaded fonts travel with the media (server fonts are fetched again).
    for (const font of project.fonts ?? []) {
      if (font.library) continue;
      const file = await getMediaFile(mediaPathFor(font.id));
      if (file) files.push({ id: font.id, file, entry: `fonts/${font.id}-${safeFileName(font.fileName)}` });
    }
    const media = Object.fromEntries(files.map((f) => [f.id, f.entry]));
    const total = files.reduce((n, f) => n + f.file.size, 0) || 1;
    let done = 0;
    const zip = new ZipWriter(target.sink);
    await zip.add(PROJECT_ENTRY, new TextEncoder().encode(serializeProject(project, media)));
    for (const f of files)
      await zip.add(f.entry, f.file, (n) => {
        done += n;
        useProjectFileTask.setState({ task: { kind: 'save', progress: done / total } });
      });
    await zip.finish();
    await target.done();
    return missing;
  } catch (e) {
    await target.fail().catch(() => {});
    throw e;
  } finally {
    useProjectFileTask.setState({ task: null });
  }
}

const isZip = async (file: Blob) => {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
};

/**
 * Open a `.vproj` or `.vprojz` as a new project and switch to it. Bundled media is copied into
 * browser storage (files already there with the same size are kept). Returns the new project id
 * and how many assets still have no file.
 */
export async function openProjectFile(file: File): Promise<{ id: ID; missing: number }> {
  useProjectFileTask.setState({ task: { kind: 'open', progress: 0 } });
  try {
    let parsed: ReturnType<typeof parseProjectFile>;
    if (await isZip(file)) {
      const entries = new Map((await readZip(file)).map((e) => [e.name, e]));
      const doc = entries.get(PROJECT_ENTRY);
      if (!doc) throw new ProjectFileError(`${PROJECT_ENTRY} missing`);
      parsed = parseProjectFile(await doc.blob.text());
      const fonts = new Set(parsed.project.fonts?.filter((f) => !f.library).map((f) => f.id));
      const media = Object.entries(parsed.media).flatMap(([id, name]) => {
        const e = entries.get(name);
        return e && (parsed.project.assets[id] || fonts.has(id)) ? [{ id, blob: e.blob }] : [];
      });
      const total = media.reduce((n, m) => n + m.blob.size, 0) || 1;
      if (!(await hasRoomFor(total))) throw new DOMException('Not enough storage', 'QuotaExceededError');
      let done = 0;
      for (const m of media) {
        const asset = parsed.project.assets[m.id];
        const path = asset?.fileRef.opfsPath ?? mediaPathFor(m.id);
        const existing = await getMediaFile(path);
        if (existing?.size !== m.blob.size)
          await writeMediaFile(path, m.blob, (f) => useProjectFileTask.setState({ task: { kind: 'open', progress: (done + f * m.blob.size) / total } }));
        done += m.blob.size;
      }
    } else parsed = parseProjectFile(await file.text());

    const project = { ...parsed.project, id: newId() };
    let missing = 0;
    for (const asset of Object.values(project.assets)) if (!(await getMediaFile(asset.fileRef.opfsPath ?? mediaPathFor(asset.id)))) missing++;
    await db.saveProject(project);
    await openProject(project.id);
    return { id: project.id, missing };
  } finally {
    useProjectFileTask.setState({ task: null });
  }
}
