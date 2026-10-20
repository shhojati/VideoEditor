# Progress

## Phase 0 — Spikes ✅ (2026-10-20)

See [SPIKES.md](SPIKES.md). Decode, MP4 export (H.264 + AAC) and Persian canvas text pass. Whisper runs fully offline.
Decision: ship tiny / base / small, with **small as the default for Persian**, and rely on the review step for corrections.

## Phase 1 — Skeleton and data model ✅ (2026-10-20)

### Done
- Vite 8 + React 19 + TypeScript 6 + Tailwind 4; ESLint (flat config, typescript-eslint, react-hooks), Prettier, Vitest (jsdom + fake-indexeddb).
- Folder layout from plan §4.3 (`src/app`, `store`, `model`, `engine/*`, `workers`, `features/*`, `lib`, `i18n`).
- **Model** (`src/model`): types per plan §4.2 (plus `TextProps`), factories with aspect presets (16:9 default, 9:16, 1:1, 4:5), zod validation with readable error paths, versioned migrations (`CURRENT_VERSION = 1`).
- **Undo/redo** (`src/store/history.ts`): Immer patches, 200-step limit, `mergeKey` to collapse continuous edits (slider drags) into one step, no-op edits are not recorded. Every project change goes through `useProjectStore().edit(labelKey, recipe)`; labels are i18n keys so the Undo tooltip is translated.
- **Persistence** (`src/store/persistence.ts`, `autosave.ts`): IndexedDB via `idb`; debounced autosave (400 ms) plus flush when the tab is hidden; save status shown in the top bar.
- **Projects** (`src/features/projects`): New / Open / Rename (inline) / Delete (with confirm). Startup reopens the last project; corrupt or too-new projects are skipped with a visible error.
- **Shell**: top bar, media bin, preview canvas (letterboxed to the project aspect), inspector (aspect + fps, undoable), timeline with track headers (add/remove/mute/lock, undoable). Timeline and preview stay LTR in the Persian UI.
- **i18n**: `fa` (default, RTL) and `en`; `<html dir/lang/title>` follow the language; choice remembered in localStorage.
- Shortcuts: Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z (text fields keep native undo).
- Startup notice when WebCodecs / OffscreenCanvas are missing (non-Chromium browsers).

### Verified
- 22 unit tests (history, migrations, validation, session: first start, reload restore, autosave, delete fallback, corrupt project, double bootstrap).
- In the browser: rename + add track + aspect change → reload → restored; Ctrl+Z / Ctrl+Y on aspect; fa ↔ en switch; no horizontal overflow at 800 px.

### Bugs found and fixed during verification
- Edit recipes that returned a value (e.g. `p => Object.assign(...)`) made Immer throw → `edit` now discards return values (test added).
- React StrictMode ran startup twice and created two projects → `bootstrap` is idempotent (test added).

### Deferred / known issues
- Radix UI not added yet; the project menu is a small custom popover and delete uses `window.confirm`. Add Radix when Phase 3/5 need dialogs, sliders and menus.
- Playwright is not set up yet — Phase 3's DoD needs it (plan wants the preinstalled Chromium).
- CI (lint, typecheck, tests) not configured; no remote repository yet.
- Environment: C: drive is full; this repo uses `.npmrc` → `cache=D:/repos/.npm-cache`, and commands set `TEMP=D:\repos\.tmp`.

## Phase 2 — Media import and bin ✅ (2026-10-20)

### Done
- **Import**: drag-and-drop onto the media bin or the Import button (multi-select). Non-media files are ignored; imports run one at a time with a progress bar.
- **Probe** (`engine/decode/probe.ts`): Mediabunny reads only headers → kind, duration, display size, average fps, codecs, `canDecode`. Images via `createImageBitmap`. Rules in `classify.ts`: undecodable video → rejected with the codec name and a "convert to H.264" hint; undecodable audio beside a good video → kept with a ⚠ warning; no tracks / unknown container / unreadable image / not enough quota → clear error.
- **Storage** (`lib/opfs.ts`): original file streamed into OPFS at `media/<assetId>` (never fully in RAM), `navigator.storage.persist()` requested, quota checked first. Asset added to the project through `edit()` → import and remove are undoable.
- **Thumbnails + waveforms** (`workers/media.worker.ts`): run in a worker reading straight from OPFS. Video: filmstrip of 4–40 JPEG frames at 90 px height (reused by the Phase 3 timeline). Audio (and video with audio): min/max peaks at 100/s. Cached in IndexedDB (`derived` store, DB v2) and regenerated when absent.
- **Missing files / relink**: on open, every asset's file is checked; missing ones show "File not found" + "Choose file". Relink requires the same kind and asks before accepting a duration more than 1 s off.
- **Cleanup** (`store/mediaGc.ts`): at startup, before any project opens, OPFS files and caches that no saved project references are deleted (removed assets, deleted projects). Deferred to startup so undo of a removal keeps working.
- fa/en strings, including the "files never leave this device" privacy note.

### Verified
- 44 unit tests (adds track classification, file sniffing, peak builder, time/byte formatting).
- In the browser (DoD): 3 videos (16:9, 9:16, 4:3), 1 WAV, 1 PNG imported → filmstrip thumbnails, waveform, metadata; a corrupt MP4 → error card; a `.txt` ignored. Reload → all 5 restored with cached previews. Deleted one file from OPFS → shown as missing → relink with a WAV rejected, with the right MP4 restored. Remove → undo restores the card; remove again + restart → its file and cache are cleaned up. No console errors.

### Decisions
- **OPFS copy instead of File System Access handles.** Works for drag-and-drop and file inputs alike, survives the original file being moved, and workers can read it. Cost: imported media uses browser storage (a second copy on disk). Handles can be added later as a "link, don't copy" option for very large files.

### Deferred / known issues
- Only tested with generated H.264/AAC files, a WAV and a PNG — no real camera footage (MOV, HEVC, long-GOP 5-minute 1080p) was available here. Please try a few of your real files.
- Removing an asset does not yet check for clips that use it (no clips exist until Phase 3).
- Filmstrip resolution is fixed at import; the timeline may want denser frames when zoomed in (Phase 3).

## Phase 3 — Timeline editing ✅ (2026-10-20)

### Done
- **Pure operations** (`model/timeline.ts`): create clip from asset, free-space search, split (keeps source continuity and speed), trim with limits (neighbours, source length, 0.1 s minimum; images unlimited), multi-clip move with collision checks, delete / ripple delete, copy / paste / duplicate, edit points. Invariant: clips on a track never overlap and stay sorted.
- **View** (`features/timeline`): canvas ruler, Ctrl+wheel zoom around the pointer, +/−/Fit buttons, native horizontal + vertical scroll, sticky track headers, playhead with ruler scrubbing, timecode. Video clips show a filmstrip, audio clips a waveform, images a repeated still. Locked tracks are hatched and inert.
- **Virtualisation**: only clips inside the visible window (in quarter-viewport chunks) are mounted, and only their visible part draws thumbnails/waveforms. ~100 clips over an 11-minute timeline → 7–9 clips mounted.
- **Interactions**: drag from the media bin (ghost preview, snaps, lands in the nearest free spot; incompatible track or the bottom zone → new track); drag clips (multi-select moves together, across tracks of the same kind); trim either edge; click / Shift- or Ctrl-click selection. Gestures only change a preview and commit once on release → one undo step each; Escape cancels.
- **Snapping** (`snapping.ts`): to clip edges, playhead, subtitle cue boundaries; 8 px threshold; toolbar magnet toggle; hold Alt to bypass.
- **Shortcuts** (by physical key, so they also work on a Persian keyboard layout): Space play/pause, S split (selection, or everything under the playhead), Delete / Shift+Delete ripple, ←/→ one frame (Shift: 10), ↑/↓ previous/next edit point, Home/End, Ctrl+C/V/D/A, Ctrl+Z/Y/Shift+Z, Ctrl +/−, Esc.
- Removing an asset also removes its clips (same undo step). New projects stack audio below video; "+ Audio track" adds at the bottom.
- **Transport** (`store/transport.ts`): playhead + play state with a temporary wall-clock loop so playback moves the playhead; Phase 4 swaps in the audio-master clock.

### Verified
- 66 unit tests (adds 22 for timeline ops + snapping).
- **Playwright E2E** (`npm run e2e`, uses the installed Chrome, no browser download): import → drag to timeline → split at 3 s → trim → move → undo/redo → reload, all asserted on clip positions.
- In the browser: drops onto occupied / incompatible tracks, mouse move and trim, split/undo/redo via keys.
- Performance with ~100 clips: scroll ≈ 3 ms per update, zoom ≈ 6 ms median (spikes to ~30 ms). No long tasks. Measured in the hidden in-app browser pane; re-check in a foreground Chrome window.

### Deferred / known issues
- No marquee (rubber-band) selection and no "magnetic main track" auto-close of gaps (ripple delete covers the common case).
- Text clips cannot be created yet (Phase 5); the Text track accepts nothing.
- Zoom re-renders all visible clips; fine at this scale, revisit if the zoom spikes are noticeable.
- Filmstrip density is fixed at import (4–40 frames); at high zoom neighbouring tiles repeat a frame.

### Next: Phase 4 — Preview and playback
First task: `renderFrame(project, time, ctx)` for video/image clips (transform, opacity, crop) using a per-asset frame cache on Mediabunny's `CanvasSink`, drawn into the preview canvas when the playhead moves while paused.
