// The top bar's search box (Ctrl+K): type a name in either language, pick with the arrows and
// Enter (or a click), and it is applied — see searchIndex.ts for what is found and what it does.
import { Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../app/icons';
import { useProject } from '../../store/projectStore';
import { loadLibrary, useLibrary } from '../library/libraryService';
import { loadServerTemplates, useTemplates } from '../templates/templateService';
import { useTimelineUi } from '../timeline/timelineUi';
import { buildEntries, search, type SearchEntry } from './searchIndex';
import { useSearchUi } from './searchUi';

/** The server lists are fetched the first time the box is used. */
function loadLists() {
  for (const kind of ['stickers', 'overlays', 'backgrounds', 'sounds'] as const) void loadLibrary(kind);
  if (!useTemplates.getState().loaded) void loadServerTemplates();
}

export function GlobalSearch() {
  const { t } = useTranslation();
  const project = useProject();
  const selection = useTimelineUi((s) => s.selection);
  const lists = useLibrary((s) => s.lists);
  const server = useTemplates((s) => s.server);
  const focusRequest = useSearchUi((s) => s.focusRequest);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  // Phones: the box opens over the top bar from the bottom navigation's Search.
  const expanded = useSearchUi((s) => s.expanded);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focusRequest) return;
    requestAnimationFrame(() => input.current?.select());
  }, [focusRequest]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !box.current?.contains(e.target as Node) && close();
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  const results = useMemo(
    () => (project && open && query.trim() ? search(buildEntries(t, project), query) : []),
    // The entries read the selection, library lists and templates when built.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, project, open, query, selection, lists, server],
  );

  function close() {
    setOpen(false);
    useSearchUi.setState({ expanded: false });
    setQuery('');
    setActive(0);
    input.current?.blur();
  }

  function run(entry: SearchEntry | undefined) {
    if (!entry || entry.disabled) return;
    close();
    entry.run();
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (results.length)
        setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(results[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  const listId = 'global-search-results';
  return (
    <div
      ref={box}
      className={`relative min-w-0 ${expanded ? 'max-md:fixed max-md:inset-x-2 max-md:top-1.5 max-md:z-50' : 'max-md:hidden'} md:w-64 lg:w-80`}
    >
      <div className="flex items-center gap-2 rounded-md border border-line bg-surface-2 px-2 focus-within:border-accent max-md:shadow-xl">
        <Icon icon={Search} size={16} className="shrink-0 text-muted" />
        <input
          ref={input}
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls={listId}
          aria-activedescendant={results[active] ? `search-${results[active].id}` : undefined}
          aria-label={t('search.label')}
          data-testid="global-search"
          dir="auto"
          className="h-8 min-w-0 flex-1 bg-transparent text-[13px] text-neutral-100 outline-none placeholder:text-muted"
          placeholder={t('search.placeholder')}
          value={query}
          onFocus={() => {
            setOpen(true);
            loadLists();
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
        />
        {query || expanded ? (
          <button className="text-muted hover:text-white" aria-label={t('panels.close')} onClick={close}>
            <Icon icon={X} size={14} />
          </button>
        ) : (
          <kbd className="font-mono text-[10px] text-muted max-md:hidden" dir="ltr">
            Ctrl+K
          </kbd>
        )}
      </div>
      {open && query.trim() && (
        <div
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-full z-50 mt-1 max-h-[60vh] overflow-auto rounded-md border border-line bg-surface-2 p-1 shadow-xl md:w-[26rem]"
        >
          {results.length === 0 && (
            <p className="px-2 py-3 text-center text-xs text-muted">{t('search.none')}</p>
          )}
          {results.map((r, i) => (
            <div key={r.id}>
              {(i === 0 || results[i - 1].group !== r.group) && (
                <div className="px-2 pt-2 pb-0.5 text-[10px] text-neutral-400 uppercase">
                  {t(`search.groups.${r.group}`)}
                </div>
              )}
              <div
                id={`search-${r.id}`}
                role="option"
                aria-selected={i === active}
                aria-disabled={!!r.disabled}
                data-testid="search-result"
                data-id={r.id}
                className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs ${i === active ? 'bg-surface-3' : ''} ${r.disabled ? 'opacity-45' : ''}`}
                onPointerEnter={() => setActive(i)}
                // Keep the focus in the box: a click runs it without blurring first.
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => run(r)}
              >
                <span className="min-w-0 flex-1 truncate" dir="auto">
                  {r.label}
                </span>
                {r.disabled ? (
                  <span className="shrink-0 text-[10px] text-muted">{r.disabled}</span>
                ) : (
                  r.keys && (
                    <kbd className="shrink-0 font-mono text-[10px] text-neutral-400" dir="ltr">
                      {r.keys}
                    </kbd>
                  )
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
