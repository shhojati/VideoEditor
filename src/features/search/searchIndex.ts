// The top bar's search: everything the app can add or do — effects, filters, LUTs, transitions,
// layouts, templates, server library items, shapes, blend modes, masks, voice and space presets,
// text animations, subtitle styles, panes and commands — as entries that apply when picked.
import type { TFunction } from 'i18next';
import i18n from '../../i18n';
import { useShortcutSheet, SHORTCUTS } from '../../app/ShortcutSheet';
import { toggleFullscreen } from '../preview/fullscreen';
import { EFFECT_DEFS, EFFECT_MENU } from '../../model/effects';
import { LAYOUTS } from '../../model/layouts';
import { BUILTIN_LUT_IDS } from '../../model/luts';
import { LOOK_MENU } from '../../model/looks';
import { BLEND_MODES, SHAPE_KINDS } from '../../model/overlays';
import type { MaskPreset } from '../../model/masks';
import { SUBTITLE_PRESETS, type SubtitlePresetId } from '../../model/subtitlePresets';
import { templateName } from '../../model/templates';
import { TEXT_ANIMS } from '../../model/textAnim';
import { findClip } from '../../model/timeline';
import { cutsOf, kindsFor, TRANSITION_KINDS } from '../../model/transitions';
import type { BlendMode, Clip, ID, LibraryKind, Project, Track } from '../../model/types';
import { setSpace, setVoice, SPACE_KINDS, VOICE_KINDS } from '../../model/voiceFx';
import { useProjectStore } from '../../store/projectStore';
import { useTransport } from '../../store/transport';
import { addAdjustmentLayer, applyFx } from '../effects/effectActions';
import { useExport } from '../export/exportService';
import { resetClipsToDefault } from '../inspector/resetActions';
import { applyLayoutToSelection } from '../layouts/layoutActions';
import { addLibraryItem, useLibrary } from '../library/libraryService';
import { addPresetMask } from '../masks/maskService';
import { openImportPicker } from '../media-bin/mediaService';
import { useNewProjectDialog } from '../projects/NewProjectDialog';
import { openPane, useSubtitlesUi, type Pane } from '../subtitles/subtitlesUi';
import { addTemplate, allTemplates, useTemplates } from '../templates/templateService';
import { applyTransition } from '../transitions/transitionActions';
import {
  addNull,
  addShape,
  addSolid,
  addText,
  deleteSelection,
  duplicateSelection,
  selectAll,
  splitAtPlayhead,
} from '../timeline/actions';
import { groupSelection, ungroupSelection } from '../timeline/compoundActions';
import { useTimelineUi } from '../timeline/timelineUi';
import { saveProject } from '../../app/shortcuts';

export const SEARCH_GROUPS = [
  'effects',
  'filters',
  'transitions',
  'templates',
  'layouts',
  'add',
  'stickers',
  'overlays',
  'backgrounds',
  'sounds',
  'blend',
  'masks',
  'voice',
  'textAnim',
  'subtitleStyle',
  'panels',
  'commands',
] as const;
export type SearchGroup = (typeof SEARCH_GROUPS)[number];

export interface SearchEntry {
  id: string;
  group: SearchGroup;
  /** In the UI language. */
  label: string;
  /** Other words it is found by: the English name, its category. */
  alt: string[];
  /** Keyboard shortcut shown beside it. */
  keys?: string;
  /** Why it cannot run now (shown dimmed); undefined when it can. */
  disabled?: string;
  run: () => void;
}

// ---- matching ---------------------------------------------------------------------------------

/** Lower case, Arabic ي/ك as Persian ی/ک, without ZWNJ, diacritics and punctuation runs. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f\u064b-\u065f\u0670]/g, '')
    .replace(/\u064a/g, '\u06cc')
    .replace(/\u0643/g, '\u06a9')
    .replace(/[\u200c\u200d]/g, '')
    .replace(/[\s\-_/·—&]+/g, ' ')
    .trim();
}

/** 4 exact, 3 prefix, 2 a word's start, 1 anywhere, 0 no match — the best of label and alt. */
export function score(entry: Pick<SearchEntry, 'label' | 'alt'>, query: string): number {
  const q = normalize(query);
  if (!q) return 0;
  let best = 0;
  for (const text of [entry.label, ...entry.alt]) {
    const s = normalize(text);
    // A name written as camelCase in English ("gaussianBlur") is also found by its words.
    const v = s === q ? 4 : s.startsWith(q) ? 3 : ` ${s}`.includes(` ${q}`) ? 2 : s.includes(q) ? 1 : 0;
    if (v > best) best = v;
    if (best === 4) break;
  }
  return best;
}

const PER_GROUP = 6;
const TOTAL = 40;

/** Matches by group (in SEARCH_GROUPS order), best first; enabled entries before disabled ones. */
export function search(entries: readonly SearchEntry[], query: string): SearchEntry[] {
  const scored = entries.map((e) => ({ e, s: score(e, query) })).filter((x) => x.s > 0);
  const out: SearchEntry[] = [];
  for (const g of SEARCH_GROUPS) {
    const hits = scored
      .filter((x) => x.e.group === g)
      .sort((a, b) => b.s - a.s || Number(!!a.e.disabled) - Number(!!b.e.disabled))
      .slice(0, PER_GROUP);
    out.push(...hits.map((x) => x.e));
  }
  // Too many: keep each group's best ones.
  if (out.length <= TOTAL) return out;
  const keep = new Set(
    [...out]
      .map((e, i) => ({ e, i, s: score(e, query) }))
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .slice(0, TOTAL)
      .map((x) => x.e),
  );
  return out.filter((e) => keep.has(e));
}

// ---- entries ----------------------------------------------------------------------------------

/** Spaced words of a camelCase id: "gaussianBlur" → "gaussian blur". */
const words = (id: string) => id.replace(/([a-z])([A-Z0-9])/g, '$1 $2').toLowerCase();

interface Context {
  t: TFunction;
  p: Project;
  /** Selected clips on unlocked tracks. */
  clips: { clip: Clip; track: Track }[];
}

function editSelected(label: string, ids: ID[], fn: (c: Clip) => void) {
  useProjectStore.getState().edit(label, (d) => {
    for (const id of ids) {
      const ref = findClip(d, id);
      if (ref && !ref.track.locked) fn(ref.clip);
    }
  });
}

/** The cut nearest the playhead: on the selected clip's track first, then on any track. */
function cutForTransition(p: Project, clips: Context['clips']) {
  const t = useTransport.getState().time;
  const tracks = new Set(clips.map((r) => r.track.id));
  const cuts = cutsOf(p).filter((c) => !c.track.locked);
  const near = (list: typeof cuts) =>
    list.sort((a, b) => Math.abs(a.to.start - t) - Math.abs(b.to.start - t))[0];
  return near(cuts.filter((c) => tracks.has(c.track.id))) ?? near(cuts);
}

function fxEntries({ t, p, clips }: Context): SearchEntry[] {
  const out: SearchEntry[] = [];
  for (const { category, kinds } of EFFECT_MENU) {
    for (const kind of kinds) {
      if (EFFECT_DEFS[kind].later || kind === 'look' || kind === 'lut3d') continue;
      out.push({
        id: `effect:${kind}`,
        group: 'effects',
        label: t(`effects.names.${kind}`),
        alt: [EFFECT_DEFS[kind].name, words(kind), t(`effects.categories.${category}`)],
        run: () => applyFx({ type: 'effect', kind }),
      });
    }
  }
  for (const { category, ids } of LOOK_MENU) {
    for (const preset of ids) {
      out.push({
        id: `filter:${preset}`,
        group: 'filters',
        label: t(`filters.names.${preset}`),
        alt: [words(preset), t(`filters.categories.${category}`)],
        run: () => applyFx({ type: 'filter', preset }),
      });
    }
  }
  for (const id of BUILTIN_LUT_IDS) {
    out.push({
      id: `lut:${id}`,
      group: 'filters',
      label: t(`luts.names.${id}`),
      alt: [words(id), 'lut'],
      run: () => applyFx({ type: 'lut', id }),
    });
  }
  const cut = cutForTransition(p, clips);
  for (const kind of TRANSITION_KINDS) {
    const fits = cut && kindsFor(cut.track).includes(kind);
    out.push({
      id: `transition:${kind}`,
      group: 'transitions',
      label: t(`transitions.kinds.${kind}`),
      alt: [words(kind), t('panels.transitions')],
      disabled: fits ? undefined : t('search.needsCut'),
      run: () => {
        if (!cut || !applyTransition(cut.from.id, cut.to.id, kind)) openPane('transitions');
      },
    });
  }
  return out;
}

function placeEntries({ t, clips }: Context): SearchEntry[] {
  const out: SearchEntry[] = [];
  for (const tpl of allTemplates(useTemplates.getState().server)) {
    out.push({
      id: `template:${tpl.id}`,
      group: 'templates',
      label: templateName(tpl, i18n.language === 'fa' ? 'fa' : 'en'),
      alt: [tpl.name.en, tpl.name.fa ?? '', t(`templates.categories.${tpl.category}`, tpl.category)],
      run: () => addTemplate(tpl),
    });
  }
  const visual = clips.filter((r) => r.track.kind !== 'audio').length;
  for (const layout of LAYOUTS) {
    out.push({
      id: `layout:${layout.id}`,
      group: 'layouts',
      label: t(`layouts.names.${layout.id}`),
      alt: [words(layout.id), t('panels.layouts')],
      disabled: visual ? undefined : t('search.needsClip'),
      run: () => applyLayoutToSelection(layout),
    });
  }
  out.push(
    {
      id: 'add:text',
      group: 'add',
      label: t('search.addText'),
      alt: ['text', 'title'],
      run: () => void addText(t('text.default')),
    },
    {
      id: 'add:solid',
      group: 'add',
      label: t('shortcuts.items.solid'),
      alt: ['solid', 'color'],
      keys: 'Ctrl+Y',
      run: () => addSolid(),
    },
    {
      id: 'add:null',
      group: 'add',
      label: t('shortcuts.items.null'),
      alt: ['null'],
      keys: 'Ctrl+Alt+Shift+Y',
      run: addNull,
    },
    {
      id: 'add:adjustment',
      group: 'add',
      label: t('shortcuts.items.adjustment'),
      alt: ['adjustment layer'],
      keys: 'Ctrl+Alt+Y',
      run: addAdjustmentLayer,
    },
  );
  for (const kind of SHAPE_KINDS) {
    out.push({
      id: `shape:${kind}`,
      group: 'add',
      label: t(`shapes.${kind}`),
      alt: [words(kind), 'shape', t('search.shape')],
      run: () => addShape(kind),
    });
  }
  const libraries: [Extract<LibraryKind, SearchGroup>, Pane][] = [
    ['stickers', 'stickers'],
    ['overlays', 'overlays'],
    ['backgrounds', 'backgrounds'],
    ['sounds', 'sounds'],
  ];
  const lists = useLibrary.getState().lists;
  for (const [kind] of libraries) {
    for (const item of lists[kind]?.items ?? []) {
      out.push({
        id: `lib:${item.url}`,
        group: kind,
        label: item.name,
        alt: [item.category, t(`panels.${kind}`)],
        run: () => void addLibraryItem(item),
      });
    }
  }
  return out;
}

function clipEntries({ t, clips }: Context): SearchEntry[] {
  const out: SearchEntry[] = [];
  const ids = clips.map((r) => r.clip.id);
  const visual = clips.filter((r) => r.track.kind !== 'audio').map((r) => r.clip.id);
  const audible = clips.filter((r) => r.track.kind === 'audio' || r.clip.assetId).map((r) => r.clip.id);
  const texts = clips.filter((r) => r.clip.text).map((r) => r.clip.id);
  const one = clips.length === 1 && clips[0].track.kind !== 'audio' ? clips[0].clip : undefined;
  const needClip = t('search.needsClip');

  for (const mode of BLEND_MODES) {
    out.push({
      id: `blend:${mode}`,
      group: 'blend',
      label: t(`blend.${mode}`),
      alt: [words(mode), 'blend'],
      disabled: visual.length ? undefined : needClip,
      run: () =>
        editSelected('ops.clipProp', visual, (c) =>
          mode === 'normal' ? delete c.blend : (c.blend = mode as BlendMode),
        ),
    });
  }
  const masks: MaskPreset[] = ['rectangle', 'ellipse', 'polygon'];
  for (const kind of masks) {
    out.push({
      id: `mask:${kind}`,
      group: 'masks',
      label: t(`masks.presets.${kind}`),
      alt: [kind, 'mask', t('search.mask')],
      disabled: one ? undefined : needClip,
      run: () => one && addPresetMask(one.id, kind, t('masks.nameN', { n: (one.masks?.length ?? 0) + 1 })),
    });
  }
  for (const kind of VOICE_KINDS) {
    out.push({
      id: `voice:${kind}`,
      group: 'voice',
      label: t(`voiceFx.names.${kind}`),
      alt: [words(kind), 'voice'],
      disabled: audible.length ? undefined : needClip,
      run: () => editSelected('ops.clipProp', audible, (c) => setVoice(c, kind)),
    });
  }
  for (const kind of SPACE_KINDS) {
    out.push({
      id: `space:${kind}`,
      group: 'voice',
      label: t(`voiceFx.spaces.${kind}`),
      alt: [words(kind), 'echo reverb'],
      disabled: audible.length ? undefined : needClip,
      run: () => editSelected('ops.clipProp', audible, (c) => setSpace(c, kind)),
    });
  }
  for (const kind of TEXT_ANIMS) {
    out.push({
      id: `textAnim:${kind}`,
      group: 'textAnim',
      label: t(`textAnim.kinds.${kind}`),
      alt: [words(kind), 'text animation'],
      disabled: texts.length ? undefined : t('search.needsText'),
      // In and out together, as a clip-level look; the inspector sets them apart.
      run: () =>
        editSelected(
          'ops.clipProp',
          texts,
          (c) => void (c.text!.anim = { ...c.text!.anim, in: kind, out: kind }),
        ),
    });
  }
  const trackId = useSubtitlesUi.getState().activeTrackId;
  for (const id of Object.keys(SUBTITLE_PRESETS) as SubtitlePresetId[]) {
    out.push({
      id: `subStyle:${id}`,
      group: 'subtitleStyle',
      label: t(`subtitles.presetNames.${id}`),
      alt: [words(id), 'subtitle caption'],
      disabled: trackId ? undefined : t('search.needsSubtitles'),
      run: () =>
        useProjectStore.getState().edit('ops.subtitleStyle', (d) => {
          const st = d.subtitleTracks.find((x) => x.id === trackId);
          if (st) Object.assign(st.style, { ...SUBTITLE_PRESETS[id], digits: st.style.digits });
        }),
    });
  }
  out.push({
    id: 'cmd:resetClip',
    group: 'commands',
    label: t('ops.resetClip'),
    alt: ['reset', 'remove effects'],
    disabled: ids.length ? undefined : needClip,
    run: () => resetClipsToDefault(ids),
  });
  return out;
}

const PANES: [Pane, string][] = [
  ['media', 'panels.media'],
  ['subtitles', 'panels.subtitles'],
  ['transcript', 'panels.transcript'],
  ['effects', 'panels.effects'],
  ['transitions', 'panels.transitions'],
  ['filters', 'panels.filters'],
  ['stickers', 'panels.stickers'],
  ['sounds', 'panels.sounds'],
  ['backgrounds', 'panels.backgrounds'],
  ['overlays', 'panels.overlays'],
  ['templates', 'panels.templates'],
  ['layouts', 'panels.layouts'],
];

/** Commands by their shortcut-sheet label (shortcuts.items.*), with the sheet's keys. */
const COMMANDS: Record<string, () => void> = {
  split: splitAtPlayhead,
  delete: () => deleteSelection(),
  rippleDelete: () => deleteSelection(true),
  duplicate: duplicateSelection,
  selectAll,
  undo: () => useProjectStore.getState().undo(),
  redo: () => useProjectStore.getState().redo(),
  save: saveProject,
  newProject: () => useNewProjectDialog.setState({ open: true }),
  import: () => {
    openPane('media');
    openImportPicker();
  },
  export: () => useExport.setState({ open: true }),
  fullscreen: toggleFullscreen,
  help: () => useShortcutSheet.setState({ open: true }),
};

function appEntries({ t }: Context): SearchEntry[] {
  const out: SearchEntry[] = PANES.map(([pane, label]) => ({
    id: `pane:${pane}`,
    group: 'panels' as const,
    label: t(label),
    alt: [pane],
    run: () => openPane(pane),
  }));
  for (const [label, run] of Object.entries(COMMANDS)) {
    out.push({
      id: `cmd:${label}`,
      group: 'commands',
      label: t(`shortcuts.items.${label}`),
      alt: [words(label)],
      keys: SHORTCUTS.find((s) => s.label === label)?.keys,
      run,
    });
  }
  out.push(
    {
      id: 'cmd:group',
      group: 'commands',
      label: t('clipMenu.group'),
      alt: ['group'],
      keys: 'Ctrl+G',
      run: groupSelection,
    },
    {
      id: 'cmd:ungroup',
      group: 'commands',
      label: t('clipMenu.ungroup'),
      alt: ['ungroup'],
      keys: 'Ctrl+Shift+G',
      run: ungroupSelection,
    },
  );
  return out;
}

/** Everything searchable for this project and selection. */
export function buildEntries(t: TFunction, p: Project): SearchEntry[] {
  const clips = useTimelineUi
    .getState()
    .selection.map((id) => findClip(p, id))
    .filter((r): r is NonNullable<typeof r> => !!r && !r.track.locked);
  const ctx: Context = { t, p, clips };
  return [...fxEntries(ctx), ...placeEntries(ctx), ...clipEntries(ctx), ...appEntries(ctx)];
}
