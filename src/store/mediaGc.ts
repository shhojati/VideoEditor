import { deleteMediaFile, listMediaFiles } from '../lib/opfs';
import { deleteDerived, listDerivedIds, referencedAssetIds } from './persistence';

/**
 * Remove stored media and caches that no saved project references (deleted projects, undone imports).
 * Must run before a project is opened: in-memory undo history may still point at unsaved assets.
 */
export async function gcMedia(): Promise<number> {
  const keep = await referencedAssetIds();
  let removed = 0;
  for (const path of await listMediaFiles()) {
    if (!keep.has(path.split('/')[1])) {
      await deleteMediaFile(path);
      removed++;
    }
  }
  for (const id of await listDerivedIds()) if (!keep.has(id)) await deleteDerived(id);
  return removed;
}
