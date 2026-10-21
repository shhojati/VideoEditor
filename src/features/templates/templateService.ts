// Templates: the built-in set plus JSON files from the server's /library/templates/ folder.
import { create } from 'zustand';
import i18n from '../../i18n';
import { listLibrary, LibraryUnavailable } from '../../lib/library';
import { BUILTIN_TEMPLATES, insertTemplate, templateSchema, type Template } from '../../model/templates';
import { useProjectStore } from '../../store/projectStore';
import { useTransport } from '../../store/transport';
import { select } from '../timeline/timelineUi';

interface TemplatesState {
  server: Template[];
  /** Server files that are not valid templates (shown so the owner can fix them). */
  invalid: string[];
  loaded: boolean;
}

export const useTemplates = create<TemplatesState>()(() => ({ server: [], invalid: [], loaded: false }));

/** Fetch and check the server's templates (a missing folder simply means none). */
export async function loadServerTemplates() {
  try {
    const items = await listLibrary('templates');
    const server: Template[] = [];
    const invalid: string[] = [];
    await Promise.all(
      items.map(async (item) => {
        try {
          const parsed = templateSchema.safeParse(await (await fetch(item.url)).json());
          if (parsed.success) server.push({ ...(parsed.data as Template), id: `server:${item.path}` });
          else invalid.push(item.path);
        } catch {
          invalid.push(item.path);
        }
      }),
    );
    useTemplates.setState({ server: server.sort((a, b) => a.name.en.localeCompare(b.name.en)), invalid, loaded: true });
  } catch (e) {
    if (!(e instanceof LibraryUnavailable)) console.warn('templates', e);
    useTemplates.setState({ server: [], invalid: [], loaded: true });
  }
}

export const allTemplates = (server: Template[]) => [...BUILTIN_TEMPLATES, ...server];

/** Insert at the playhead, on new graphics tracks on top (one undo step), and select it. */
export function addTemplate(tpl: Template) {
  let ids: string[] = [];
  const rtl = i18n.language === 'fa';
  useProjectStore.getState().edit('ops.addTemplate', (d) => void (ids = insertTemplate(d, tpl, useTransport.getState().time, rtl)));
  select(ids);
}
