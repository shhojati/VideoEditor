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

## Phase 4 — Preview and playback ✅ (2026-10-20)

### Done
- **`renderFrame(project, t, ctx, lookup)`** (`engine/render/renderFrame.ts`): pure, synchronous compositor shared with the future exporter. Visual tracks bottom → top; per clip: fit (`contain` default / `cover`), crop (fractions of the source), scale, rotation, offset (fractions of the canvas), opacity. Text clips get basic drawing (`render/text.ts`) until Phase 5. `Transform` gained optional `fit`; semantics are documented on the type.
- **Video frames** (`engine/playback/videoFrames.ts`): paused → one exact seek per clip at a time with newest-request-wins, so scrubbing never builds a backlog; playing → a read-ahead stream per clip (6 frames, starting 1 s before a clip appears), frames the clock has passed are dropped. Every `VideoSample` is closed when replaced.
- **Readers** (`engine/decode/mediaReader.ts`): one Mediabunny `Input` per asset with video + audio sinks (images: one `ImageBitmap`), opened lazily and closed when the asset leaves the project.
- **Audio** (`engine/audio/audioEngine.ts`): each audible clip decodes progressively and schedules buffers 2 s ahead on the `AudioContext`; per-clip gain (volume + linear fade automation, correct when starting mid-fade), track mute, master volume, speed via `playbackRate`. Its output clock (`getOutputTimestamp`, latency-compensated) is the master clock.
- **Engine** (`engine/playback/engine.ts`): reacts to the transport store (play / pause / seek / volume / loop), restarts 150 ms after an edit made while playing, stops at the end or loops, renders into the preview.
- **Preview UI**: letterboxed canvas sized to the panel × devicePixelRatio (capped at project resolution); transport bar with previous/next edit, ±1 frame, play/pause, HH:MM:SS:FF timecode, loop, volume, Fit/Fill for selected clips. Aspect presets from Phase 1.

### Verified
- 78 unit tests (adds placement/crop/rotation, layer order, fades, gain automation).
- **Paused seek accuracy**: 12 random seeks across clips all landed on the frame containing the requested time; 55 ms median, 128 ms max (budget 500 ms).
- **A/V sync E2E** (`e2e/playback.spec.ts`, headless Chrome, ~2.4 min): 5 video clips (with in-points) + 6 audio clips with fades, 120 s. **Shown frame never trailed the clock (max lag 0 ms), 0 dropped of ~7,200 frames (~60 fps), 0 late audio buffers of 11,257** (DoD < 80 ms). Clock tracked wall time.
- Fit/Fill: a 9:16 clip with `cover` fills the 16:9 frame.

### Decisions
- **Decoding runs on the main thread, not in a worker** (plan §4.4 said worker). WebCodecs already decodes on its own threads; only demuxing is JS, and measurements above show no frame loss. `VideoFrames` is the only consumer, so moving it into a worker later (transferring `VideoFrame`s) stays contained if real 1080p camera footage needs it.
- Speed changes use `playbackRate`, so audio pitch shifts with speed. Pitch-preserving speed is post-MVP.

### Deferred / known issues
- Measured with generated 960×540 H.264; long-GOP 1080p camera files will seek slower (decode from the previous keyframe).
- No on-canvas handles for move/scale/rotate yet (inspector numbers come in Phase 5).
- The in-app browser pane suppresses `requestAnimationFrame` while hidden, so the preview only repaints when visible; Chrome tabs behave normally.

## Phase 5 — Text overlays and inspector ✅ (2026-10-20)

### Done
- **Fonts**: five bundled, self-hosted fonts — Vazirmatn (variable), Lalezar, Noto Naskh Arabic, Markazi Text (all Persian-capable) and Inter. `copy-assets.mjs` parses the fontsource CSS into `public/fonts/manifest.json` (Persian + Latin subsets with unicode ranges); `lib/fonts.ts` registers them through the `FontFace` API on first use (so the Phase 7 export worker can do the same). Missing glyphs fall back to Vazirmatn. The engine redraws once a font has loaded.
- **Text clips**: "T+ Text" adds a clip at the playhead on a free text track (or a new one on top), selected for editing. Rendering (`engine/render/text.ts`): word wrap at a max line width without ever breaking inside a word (ZWNJ-safe, `textLayout.ts`), alignment, RTL/LTR, rounded background box, outline, shadow, fade in/out, plus the clip transform.
- **Direction**: follows the first strong character of the text automatically, until the user picks a direction by hand.
- **Inspector** (`features/inspector`): one selected clip → Timing (start, duration, speed 0.5–2× with presets), Text (content, font, weight, size, colour, align, direction, line width, background, outline, shadow, fade presets + exact fades), Transform (x/y as % of the frame, scale, rotation, opacity, fit/fill, crop on 4 sides), Audio (volume 0–200%, fades). Locked tracks show it read-only. Otherwise → project settings.
- **Undo**: every control goes through `edit()` with a per-clip, per-property `mergeKey`, so a slider drag or a typing burst is one undo step, and each property undoes independently.
- `setClipSpeed` keeps the source range (shortening the clip if the next one is in the way); `addTextClip`; `Transform.fit`; `TextProps` gained shadow and max width.

### Verified
- 92 unit tests (adds wrapping incl. ZWNJ, direction detection, text-clip placement, speed).
- **E2E `e2e/text.spec.ts`** (DoD): Persian text → size, colour, font, background, position changed → red Lalezar pixels confirmed in the preview → five undos revert those properties in reverse order → five redos restore them → English text added as LTR → reload keeps both. Screenshots of both previews checked: Persian joining and punctuation are correct.
- All three E2E specs and lint/typecheck pass.

### Bugs found and fixed
- Replacing the default (English) text with Persian kept the clip LTR → direction now follows the content unless overridden.
- New text started with a fade-in, so it was invisible on the frame where it was created → new text has no fade by default (presets are one click away).

### Deferred / known issues
- No on-canvas handles (drag/scale text in the preview); position is set numerically.
- Text edits multi-selection: inspector shows only "N clips selected".
- A colour picked with `<input type=color>` has no alpha; translucent boxes need a later alpha slider.

### Next: Phase 6 — Subtitles
First task (6a): subtitle tracks in the model's `subtitleTracks` shown as a timeline lane with draggable/trimmable cues, plus a cue list panel (inline edit, set start/end to playhead, add/delete/split/merge).
