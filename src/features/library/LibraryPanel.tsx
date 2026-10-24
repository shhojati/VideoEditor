import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { create } from 'zustand';
import { LIBRARY_EXTENSIONS, type LibraryItem } from '../../lib/library';
import { formatBytes } from '../../lib/time';
import type { LibraryKind } from '../../model/types';
import { addLibraryItem, endLibraryDrag, loadLibrary, startLibraryDrag, useLibrary } from './libraryService';

/**
 * One server library folder as a pane: search, categories (subfolders), and items that are added
 * at the playhead on click or dragged onto the timeline.
 */
export function LibraryPanel({ kind }: { kind: LibraryKind }) {
  const { t } = useTranslation();
  const listing = useLibrary((s) => s.lists[kind]);
  const busy = useLibrary((s) => s.busy);
  const [query, setQuery] = useState('');

  useEffect(() => void loadLibrary(kind), [kind]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const items = (listing?.items ?? []).filter((i) => !q || i.name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q));
    const map = new Map<string, LibraryItem[]>();
    for (const i of items) map.set(i.category, [...(map.get(i.category) ?? []), i]);
    return [...map];
  }, [listing, query]);

  const folder = `library/${kind}/`;
  const types = LIBRARY_EXTENSIONS[kind].map((e) => `.${e}`).join(', ');

  return (
    <div className="flex h-full flex-col" data-testid={`library-${kind}`}>
      <div className="flex gap-1 border-b border-line p-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('library.search')}
          aria-label={t('library.search')}
          className="min-w-0 flex-1 rounded bg-surface-3 px-2 py-1 text-xs"
        />
        <button
          className="rounded px-2 text-sm text-neutral-300 hover:bg-surface-3"
          onClick={() => void loadLibrary(kind, true)}
          title={t('library.refresh')}
          aria-label={t('library.refresh')}
        >
          ⟳
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {!listing || listing.status === 'loading' ? (
          <p className="p-2 text-xs text-neutral-400">{t('library.loading')}</p>
        ) : listing.status === 'unavailable' || (listing.status === 'ready' && listing.items.length === 0) ? (
          <div className="space-y-2 p-2 text-xs text-neutral-400" data-testid="library-empty">
            <p>{t(`library.empty.${kind}`)}</p>
            <p>{t('library.howTo', { folder, types })}</p>
          </div>
        ) : listing.status === 'error' ? (
          <p className="p-2 text-xs text-red-400">{t('library.error', { error: listing.error })}</p>
        ) : groups.length === 0 ? (
          <p className="p-2 text-xs text-neutral-400">{t('library.noMatch')}</p>
        ) : (
          groups.map(([category, items]) => (
            <section key={category} className="mb-3">
              {(category || groups.length > 1) && (
                <h3 className="mb-1.5 text-[11px] font-medium tracking-wide text-neutral-400 uppercase" dir="auto">
                  {category || t('library.general')}
                </h3>
              )}
              <div className={kind === 'sounds' ? 'flex flex-col gap-1' : `grid gap-1.5 ${kind === 'stickers' ? 'grid-cols-3' : 'grid-cols-2'}`}>
                {items.map((item) => (
                  <ItemTile key={item.url} item={item} busy={!!busy[item.url]} />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
      <p className="border-t border-line px-2 py-1.5 text-[11px] text-neutral-500">{t('library.hint')}</p>
    </div>
  );
}

function ItemTile({ item, busy }: { item: LibraryItem; busy: boolean }) {
  const { t } = useTranslation();
  const common = {
    draggable: true,
    'data-testid': 'library-item',
    'data-path': item.path,
    title: `${item.name} — ${t('library.addHint')}`,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('text/plain', item.name);
      startLibraryDrag(item);
    },
    onDragEnd: endLibraryDrag,
    onClick: () => void addLibraryItem(item),
  };
  // Stickers and still backgrounds are pictures; overlays and moving backgrounds are videos.
  const picture = item.kind === 'stickers' || (item.kind === 'backgrounds' && !/\.(mp4|webm)$/i.test(item.fileName));
  const spinner = busy && (
    <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-xs text-white" aria-label={t('library.downloading')}>
      ⏳
    </span>
  );

  if (item.kind === 'sounds')
    return (
      <div
        {...common}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && void addLibraryItem(item)}
        className="relative flex cursor-grab items-center gap-2 rounded bg-surface-2 px-2 py-1.5 text-xs hover:bg-surface-3"
      >
        <SoundPreview url={item.url} />
        <span className="min-w-0 flex-1 truncate" dir="auto">
          {item.name}
        </span>
        {item.size !== undefined && <span className="text-[10px] text-neutral-500">{formatBytes(item.size)}</span>}
        {spinner}
      </div>
    );

  return (
    <button
      {...common}
      // Overlay videos show their first frame and play muted while hovered.
      onMouseEnter={(e) => void e.currentTarget.querySelector('video')?.play().catch(() => {})}
      onMouseLeave={(e) => e.currentTarget.querySelector('video')?.pause()}
      className="relative flex cursor-grab flex-col overflow-hidden rounded bg-surface-2 text-start hover:ring-1 hover:ring-accent"
    >
      <div
        className={`flex w-full items-center justify-center ${
          item.kind === 'stickers' ? 'aspect-square bg-[repeating-conic-gradient(#2b303b_0%_25%,#20242d_0%_50%)] bg-[length:12px_12px]' : 'aspect-video bg-black'
        }`}
      >
        {item.kind === 'stickers' ? (
          <img src={item.url} alt="" loading="lazy" draggable={false} className="max-h-full max-w-full object-contain p-1" />
        ) : picture ? (
          <img src={item.url} alt="" loading="lazy" draggable={false} className="h-full w-full object-cover" />
        ) : (
          <video src={`${item.url}#t=0.1`} muted loop playsInline preload="metadata" className="pointer-events-none max-h-full max-w-full" />
        )}
      </div>
      <span className="w-full truncate px-1 py-0.5 text-[10px] text-neutral-300" dir="auto">
        {item.name}
      </span>
      {spinner}
    </button>
  );
}

/** One sound preview plays at a time. */
const usePreview = create<{ url: string | null }>()(() => ({ url: null }));
let previewAudio: HTMLAudioElement | null = null;

function SoundPreview({ url }: { url: string }) {
  const { t } = useTranslation();
  const playing = usePreview((s) => s.url === url);
  return (
    <button
      className="w-6 shrink-0 rounded bg-surface-3 text-center hover:bg-accent"
      aria-label={playing ? t('library.stop') : t('library.listen')}
      draggable={false}
      onClick={(e) => {
        e.stopPropagation();
        previewAudio?.pause();
        if (playing) return usePreview.setState({ url: null });
        previewAudio = new Audio(url);
        previewAudio.onended = () => usePreview.setState({ url: null });
        void previewAudio.play().catch(() => usePreview.setState({ url: null }));
        usePreview.setState({ url });
      }}
    >
      {playing ? '■' : '▶'}
    </button>
  );
}
