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

## Phase 6 — Subtitles ✅ (2026-10-20)

### Done
- **6a Editing**: subtitle tracks appear as lanes above the video tracks; cues can be dragged (selection moves together) and trimmed, with snapping and one undo step per gesture. The left column has **Media | Subtitles** tabs. The Subtitles tab holds tracks, the cue list with inline text editing, ⇤/⇥ set start/end to the playhead, split at the playhead, merge with the next cue, delete, add at the playhead, an "only issues" filter, and click-to-seek. S splits and Delete removes selected cues on the timeline too.
- **Validation** (`model/subtitles.ts`): 1–7 s duration, ≤ 42 characters/line, ≤ 2 lines, ≥ 80 ms gap, ≤ 20 chars/s, overlap, empty, review. Shown as badges in the list and amber cues on the timeline. **Fix timing** resolves overlaps and gaps, caps long cues and extends short ones without touching the text.
- **6b Styling** (`engine/render/subtitles.ts`): drawn inside `renderFrame` (preview = export, with a burn-in switch for Phase 7). Two-line balanced wrapping that never breaks inside a word, per-line rounded boxes with opacity, outline, top/middle/bottom + margin, max width, Persian/Latin digit conversion. Sizes are relative to a 1080-pixel short side, so styles survive aspect changes. Presets: Classic, Boxed, Yellow outline, Social. The style editor opens in the inspector when a cue is selected; language and direction live there too. Tracks can be hidden.
- **6c SRT/VTT** (`lib/subtitles/formats.ts`): lenient import (BOM, CRLF, missing indices, `.`/`,` millis, mm:ss, `<i>`/`<font>`/`{\an8}` tags, entities, stray RLM/LRM/RLE/PDF dropped, ZWNJ kept, malformed blocks counted and skipped). Export SRT/VTT as UTF-8 **with BOM, CRLF, and an RLM at the start of each RTL line** so players that guess direction from the first strong character (VLC) keep Persian lines RTL even when they start with digits or Latin.
- **6d Auto subtitles**:
  - **Audio**: the media worker mixes the timeline's audible clips (or just the selected ones) to 16 kHz mono, respecting placement, in-point, speed and volume.
  - **Windows**: `planWindows` cuts ≤ 28 s windows in the middle of the quietest moment near each limit and skips silent windows (prevents hallucinated text on silence).
  - **Whisper**: runs in `workers/stt.worker.ts` from local files only, WebGPU (q4 decoder) with automatic fallback to WASM (q8).
  - **Post-processing** (`engine/stt/postprocess.ts`): collapses repetition loops, splits long segments to ≤ 84 chars / ≤ 7 s, flags doubtful cues for review, then runs Fix timing.
  - **UI**: model picker showing which models are installed (HEAD checks against our own server) with a default of **small**; language fa/en/ar/auto; progress, real-time factor, cancel; runs in the background; clear errors for a missing model or no audio.
- `Cue.flag`, `SubtitleTrack.hidden`, `SubtitleStyle.{fontWeight,bgOpacity,digits}` added to the model (optional fields, no migration needed).

### Verified (DoD)
- **Persian end to end in the in-app browser**: a 145 s video with real Persian speech (12 Common Voice clips, twice) → auto subtitles with `small` on WebGPU in **3.5 min including model load (≈1.2× real time; the Phase 0 spike measured 2.9×)** → 26 well-timed cues, no repetition loops. Four cues corrected in the list, Boxed preset and Persian digits applied → preview shows `آیا حضرت عالی مرا صدا زدید؟` with correct joining and `؟` placement → SRT exported with BOM, CRLF and per-line RLM. Network: models and WASM from localhost only.
- 125 unit tests (adds SRT/VTT incl. malformed and RTL-mark cases, cue ops, lint rules, auto-fix, digits, balanced wrapping, 16 kHz mixing, window planning, repetition collapse, segment → cue).
- E2E `e2e/subtitles.spec.ts`: import SRT (Persian, RLM, `<i>`, a broken block) → edit text → drag a cue → split with S → undo/redo → Persian digits → exported SRT checked byte for byte. An opt-in E2E (`STT_E2E=1`) runs real speech-to-text with `tiny` on 72 s of Persian speech in headless Chrome: passes in 1.1 min.
- ⚠ Not verified in VLC: VLC is not installed here. Please open an exported `.srt` with your video in VLC once.

### Bugs found and fixed
- Generated cues touched each other (14 of 26 flagged "small gap") → generated tracks now go through Fix timing.
- Clicking a cue/clip on the timeline left focus in a text field, so `S` typed a letter instead of splitting → timeline gestures now blur text fields.
- Window cutting landed mid-range when there was no quiet spot → cuts at the limit in that case.

### Deferred / known issues
- Persian accuracy of stock Whisper `small` is a draft that needs review (as decided after Phase 0). Upgrade paths: `whisper-large-v3-turbo` (WebGPU) or a Persian fine-tuned model converted to ONNX.
- Karaoke / active-word highlighting: needs word timestamps (cross-attention export); `highlightActiveWord` is in the model but not rendered.
- Per-cue style overrides, cue copy/paste and multi-track subtitle stacking (two visible tracks at the same position overlap) are not done.
- Speed ≠ 1 clips are fed to STT at the changed speed (pitch shifted), which may lower accuracy.

## Phase 7 — Export ✅ (2026-10-20)

### Done
- **Dialog** (`features/export`): 720p/1080p (short side, aspect kept, even sizes), 24/25/30/50/60 fps, quality Small/Medium/High (≈0.06/0.12/0.2 bits per pixel per frame; 1080p30 Medium ≈ 7.5 Mbps), burn in subtitles on/off, also save `.srt` for each visible subtitle track, an upper-bound size estimate, progress with ETA, and cancel. Opened from the **Export** button in the top bar.
- **Pipeline** (`workers/export.worker.ts`, plan §4.5): for each output frame it decodes exact source frames sequentially per clip (`ExactClipFrames`, never drops), draws with the same `renderFrame` as the preview into an `OffscreenCanvas`, and encodes H.264 (keyframe every 2 s) with backpressure. Fonts for text and subtitles are loaded inside the worker via the `FontFace` manifest.
- **Audio**: workers have no Web Audio, so `engine/export/audioMix.ts` mixes offline: each audible clip's source range is decoded, resampled to 48 kHz with linear interpolation following speed, multiplied by the player's volume/fade curve, summed and limited. It is encoded as AAC 160 kbps (Opus with a warning if AAC is unavailable) in 1 s chunks, interleaved with video so the muxer never holds the whole file.
- **Output**: with the File System Access save dialog the MP4 streams straight to the chosen file (`StreamTarget`, chunked), and a cancelled or failed export removes the partial file. Without it, the file is built in memory (`fastStart`) and offered as a download.

### Verified
- 131 unit tests (adds output size, bitrate, frame count, mix placement / in-point / speed / interpolation / fades / summing).
- **E2E `e2e/export.spec.ts`** (Mediabunny probes the output in place of ffprobe, which is not installed here):
  - **Download path**: duration 8.000 s (±50 ms required), H.264 + AAC, 1280×720. Burned-in Persian subtitle box present during the cue and gone after it, the red image at 7 s, and audio RMS 0.21, the exact level of the source tone.
  - **Streaming path**: the export lands in the file returned by the save dialog; duration, codecs checked.
- **Performance DoD (`EXPORT_PERF=1`)**: 2-minute 1080p30 project (5 video clips, 6 audio clips with fades, 30 burned-in Persian subtitles) exported in **50 s = 0.42× real time** (target < 2×), duration exactly 120.000 s, 38 MB. A frame at 41 s shows the correct source frame (330) and correctly shaped subtitle.
- ⚠ Not verified in VLC / Windows player (not installed). Please open one export in a desktop player.

### Decisions
- Audio is mixed into whole-timeline buffers (stereo float, ~23 MB per minute) rather than streamed block by block: simple and exact, and well within the 1.5 GB budget for ≤ 5-minute projects. Revisit for long-form.
- MP4 written to disk is not "fast start" (index at the end), which is fine for local playback and editing; downloads are fast-start.

### Deferred / known issues
- No memory measurement inside the worker beyond the design (frames closed promptly, encoder backpressure, 1 s audio chunks).
- Speed-changed audio is resampled (pitch shifts), matching preview.
- Hardware-encoder availability varies by machine; the encoder is chosen by the browser.

### Testing note
- E2E runs share a Vite **dev** server (they use dev-only hooks such as `window.__stores` and the spike fixtures). Editing source files while E2E is running hot-reloads the page under test and makes long tests fail spuriously. That caused one false STT failure; the isolated re-run passed.

## After Phase 8 (decided 2026-10-20)
- **Transitions** as the first post-MVP feature: crossfade/dissolve (with audio crossfade), dip to black/white, wipe/slide/push, zoom/blur. Design: a transition on the cut between two touching clips, centred on the cut and capped by source handles, blended in `renderFrame`, with two-clip decoding during the window, a Transitions tab, and an inspector for type and duration.

## Phase 8 — Polish, reliability, release ✅ (2026-10-20)

### Done
- **Startup capability check** (`app/capabilities.ts`, `StartupCheck.tsx`). Required: secure context (https/localhost), WebCodecs, H.264 encode, OPFS, OffscreenCanvas; if any is missing, the editor is replaced by an explanation. Optional: COOP/COEP isolation, WebGPU, AAC encode, save dialog; these show a dismissible notice of what is degraded.
- **Errors**: per-panel error boundaries (one broken panel doesn't take down the editor; the project is autosaved independently), global toasts for unhandled errors, friendly messages for storage quota and out-of-memory (also in the export dialog).
- **Onboarding**: a welcome card on empty projects with the four steps and "Open sample project". The sample is generated in the browser (no bundled media): an animated video with soft audio, a Persian title in Lalezar and two subtitles. A **keyboard shortcut sheet** opens with `?` (or the ⌨ button) and works with the Persian layout.
- **Accessibility**: axe scan in fa and en with no serious or critical violations. Fixed contrast (accent blue → blue-600, 5.2:1 with white; secondary grey text lightened to ≥ 4.5:1). Icon buttons have labels, dialogs use `role=dialog`, focus outlines are visible.
- **Release build**: `npm run build` → `dist/` (~55 MB app + ~1.1 GB models). Test audio (`spike-data`) is excluded from builds, only the ONNX Runtime WASM variant that is used gets shipped, and an app icon was added. **[docs/DEPLOY.md](DEPLOY.md)** covers HTTPS, COOP/COEP, MIME types and caching for nginx / IIS / Apache, plus a verification checklist. New **README.md**.
- **Tests**: `npm run e2e:prod` builds and runs the production bundle. A new user's path (sample → split → edit subtitle → `?` sheet → export → valid MP4 → reload) runs with **zero console errors**, plus the axe scan. `npm run ci` runs lint, typecheck, unit, E2E and production smoke. Guard tests catch invisible bidi characters in source and fa/en translation key mismatches.

### Verified
- Lint, typecheck, 132 unit tests, dev E2E (timeline, playback, text, subtitles, export ×2), production smoke + axe: all green.
- The playback E2E failed once when run in parallel with the other specs and a fresh `dist` build on a busy machine (one 2.7 s video stall). Run alone it passed with 0 dropped frames and 0 lag. The frame source now records `worstAt` (timeline time of the worst lag) to diagnose this if it recurs.

- **AAC everywhere** (owner request after seeing the Opus warning): `engine/export/aac.ts` uses the browser's AAC encoder when present, otherwise registers `@mediabunny/aac-encoder` (libavcodec in WASM, MPL-2.0, ~1 MB, loaded lazily, WASM embedded in an inline worker, no network). It covers Firefox, Windows N/KN without the Media Feature Pack, and some Chromium builds. The export dialog notes when it was used; Opus remains only as a last resort. The "no AAC" startup notice was removed. E2E `e2e/aac.spec.ts` simulates a browser without AAC, and the output is still AAC, audible, with no off-origin requests.

### Known issues / open
- Bundler emits a second, unused 27 MB copy of the ONNX Runtime WASM (`dist/assets`), referenced by transformers.js internally.
- No CI server configured (no remote repository); `npm run ci` is ready to drop into one.

## Post-MVP 1 — Transitions ✅ (2026-10-20)

### Done
- **Model** (`model/transitions.ts`): `Track.transitions` — kind, duration, from/to clip on a cut between touching clips. The transition is centred on the cut, defaults to 0.5 s and is capped at 3 s, and each half fits inside its clip next to that clip's other transition. **14 kinds**:
  - crossfade
  - dip to black / white
  - wipe left / right / up / down
  - slide left / right
  - push left / right
  - zoom in / out
  - blur

  Audio tracks accept crossfade only.
- **Always valid**: every `edit()` ends with `normalizeTransitions`, so transitions are dropped when clips move apart or are deleted, shortened when a trim makes them too long, and moved to the right-hand part when the outgoing clip is split. No-op edits stay no-ops.
- **Rendering** (`render/transitions.ts`, `renderFrame.ts`): a per-track draw plan (plain clip or transition at progress p) blended in `renderFrame`, so preview = export. Motion uses smoothstep easing. Text and media alpha now multiply, so transitions also fade text clips.
- **Footage beyond the cut**: the outgoing clip keeps playing and the incoming clip starts early, using real media where it exists; otherwise the first/last frame is held. Preview streams and export exact frames decode both clips over the extended range.
- **Audio crossfade**: equal-power (sin/cos) over the part of the window where both clips have real audio. With handles it is a full crossfade at constant power; without them it shrinks to a clean cut (no level dip). The same envelope drives Web Audio value curves in the player and the export mix; clip fades still apply on sides without a transition.
- **UI**: a **Transitions** tab (drag a card onto a cut; the target cut highlights). Every cut gets a ◆ marker, and each transition a badge spanning its duration; both sit in a bottom strip so trim handles stay usable. The inspector picks the type and duration (one undo step per drag) and removes it; Delete also removes a selected transition. fa/en strings.

### Verified
- 150 unit tests (adds rules, validity after move/delete/trim/split, blend maths per kind, draw plan, equal-power envelopes with and without handles).
- **E2E `e2e/transitions.spec.ts`**: red and blue clips with tones and 0.5 s handles; Crossfade dragged from the tab onto the cut; duration 1 s.
  - Preview midpoint (127,0,128) matches the exported frame (127,0,127), with pure colours outside the window and the timeline length unchanged.
  - Audio RMS at the cut 0.209 vs 0.211 beside it: constant power.
  - Switching to Dip to black gives a black midpoint; undo restores the crossfade; moving a clip away removes the transition.
- All other E2E, production smoke and axe still pass. An earlier marker position blocked trimming at a cut; the timeline E2E caught it and the markers moved to the bottom strip.

### Known issues / not done
- Transitions only between clips on the same track that touch; no "transition from/to black" at the timeline start or end yet (use dip on a cut, or a fade).
- Without handles video holds a frame; there is no automatic overlap mode (CapCut-style shortening of the timeline) as an alternative.
- No per-transition easing or direction options beyond the 14 kinds.

### Next
Owner to try the MVP plus transitions on real footage, the internal server and VLC.

## Post-MVP 2 — Preview zoom, canvas handles, shapes, blend modes, project files ✅ (2026-10-21)

### Done
- **Preview zoom and pan** (`features/preview/previewView.ts`): Fit, 25/50/100/200/400 % presets and −/+ in the transport bar (the current level is shown), Ctrl+wheel zooms about the pointer (5–800 %), wheel / Shift+wheel / Space+drag / middle-drag pan, two-finger pinch on touch. Panning stops a quarter viewport past the picture's edge. The canvas now covers the whole preview area and the engine draws through a view transform, clipped to the frame; the backing store follows the viewport, so zooming in stays sharp (text, shapes) without costing more pixels. Over the preview, Space plays/pauses on release unless it was used to pan.
- **On-canvas handles** (`CanvasOverlay.tsx`, `canvasGeometry.ts`): click the topmost clip under the pointer to select it (Shift/Ctrl toggles), drag to move (snaps the centre to the frame centre lines and unrotated edges to the frame edges, with guides; Alt: no snap; Shift: one axis), corner handles resize (media and text scale uniformly; shapes resize freely, Shift keeps proportions, Alt resizes about the centre), edge handles on shapes, a rotate handle (Shift: 15° steps), and draggable end points for lines. Works for video, image, text and shape clips, at any zoom. Each drag is one undo step (`EditOptions.gesture` merges regardless of time); Escape cancels a drag.
- **Shapes** (`model/overlays.ts`, `engine/render/shapes.ts`, `features/inspector/ShapeSection.tsx`): rectangle, square, circle, oval, triangle, star, line, from **★+ Shape** in the timeline toolbar, at the playhead. They live on the Text track, now labelled **Overlay** (the stored kind stays `text`, so no migration). Inspector: type (switching keeps size/colours sensibly), width/height (square and circle stay square), fill on/off + opacity, stroke colour/width/opacity, solid/dashed/dotted, rounded corners (rectangle, square, triangle), star points + inner radius, line arrowheads (start/end/both), shadow, fade presets + exact fades. Timeline clips show the shape icon and name.
- **Blend modes per clip** (`engine/render/blend.ts`): Normal; Darken, Multiply, Color burn, Darker color; Lighten, Screen, Color dodge; Overlay, Soft light, Hard light; Difference; Hue, Saturation, Color, Luminosity — for video, image, text and shape clips. A blended clip is drawn into its own layer and composited in one go (so its own fill/stroke/box do not blend with each other, as in Photoshop), through the frame's current state, so transitions, opacity and fades still work. Darker color is computed per pixel (Rec. 601 luma). Picked in a **Blending** section in the inspector; a ◐ badge on the timeline clip names the mode.
- **Project files** (`features/projects/projectFile.ts`, `lib/zip.ts`), in the Projects menu:
  - **Save project file (.vproj)**: the project as JSON (format tag + version). Media stays in the browser; elsewhere it opens with "File not found" + Choose file.
  - **Save project with media (.vprojz)**: a stored (uncompressed) ZIP with `project.json` and every media file, ZIP64 when over 4 GB; streamed to the save dialog's file, or a download built from on-disk blobs.
  - **Open project file…**: either kind (sniffed by content), migrated and validated, opened as a **new copy** (new id); bundled media goes into OPFS first (same-size files already there are kept). Progress shows next to the menu; a notice says how many files need relinking; broken files are refused with a reason.

### Verified
- 181 unit tests (adds view maths, box geometry/resize/rotate/line ends/snapping/write-back, shape painting with opacities and dashes, star geometry, kind switching, darker-colour pixels, validation of shapes and blend modes, project file round-trip and refusals, ZIP CRC and round-trip with UTF-8 names).
- **E2E `e2e/canvas.spec.ts`**:
  - Zoom: Ctrl+wheel keeps the point under the pointer, Space+drag pans by exactly the drag and does not start playback, 100 % shows 1920 CSS px, Fit restores.
  - Shapes: square added from the menu; move, corner resize (stays square) and Shift-rotate (multiple of 15°) are one undo step each and undo back to the start. Blue square over red: **preview = export** for multiply (37,0,0), darker colour (255,1,0 — red is darker, so it stays) and screen (255,100,235).
  - Project files: `.vproj` download holds the same tracks; `.vprojz` starts with a ZIP header. With the media deleted from OPFS, the bundle restores the file (asset ready, yellow star screened over red in the preview); the plain file opens with the asset missing and the relink notice; a non-project JSON is refused.

### Known issues / not done
- Darker color reads the canvas back each frame (≈ 18 ms per preview frame at 733×446 here); it slows export when used on long clips. A WebGL compositor would remove that cost.
- Text boxes on the canvas use the measured block; wrapping changes as you scale, so a corner drag on wrapped text is approximate.
- Canvas handles move several selected clips together, but resize/rotate act on a single selection only.
- Opening a project file always makes a copy; there is no "replace existing project".

## Post-MVP 3 — After Effects blend modes, library panes (Stickers, Sound FX, Overlays) ✅ (2026-10-21)

### Done
- **Blend modes, After Effects' list** (`engine/render/blend.ts`), in its groups: Normal, Dissolve, Dancing Dissolve | Darken, Multiply, Color Burn, Classic Color Burn, Linear Burn, Darker Color | Add, Lighten, Screen, Color Dodge, Classic Color Dodge, Linear Dodge, Lighter Color | Overlay, Soft Light, Hard Light, Linear Light, Vivid Light, Pin Light, Hard Mix | Difference, Classic Difference, Exclusion, Subtract, Divide | Hue, Saturation, Color, Luminosity (32).
  - 19 are composited by the browser (Add and Linear Dodge = `lighter`; Classic Difference = Difference, identical at 8 bits per channel).
  - The other 13 are computed per pixel: separable ones via a 256×256 lookup table per mode; Darker/Lighter Color compare Rec. 601 luma of the whole pixel; Dissolve shows each pixel fully or not at all with probability = its opacity (stable per clip), Dancing Dissolve re-rolls 30×/s. The inspector notes that these are slower.
  - "Classic" burn/dodge use the original formulas without the black/white special cases; at 8 bits they differ from the new ones only at the extremes.
- **Library panes** (`lib/library.ts`, `features/library/`): **Stickers** (.png/.gif), **Sound FX** (.ogg/.mp3), **Overlays** (.mp4/.webm/.mov) list `library/<kind>/` on the server (subfolders = categories), with search and reload. Stickers show thumbnails on a checkerboard, overlays play muted on hover, sounds have a ▶ preview. Click adds at the playhead; drag drops on the timeline (if dropped before the download finished, the clip is placed there once it is in). The file is downloaded and imported once per project (asset remembers `library: { kind, path }`) and reused afterwards. Stickers start at 35 % scale; overlays go on a new video track above with blend **Screen**.
- **Animated GIF (and APNG/WebP)** (`engine/decode/animatedImage.ts`): all frames decoded once with `ImageDecoder`, looped by clip time, in preview and export (`FrameLookup` now gets the time).
- **Server**: nginx lists `/library/` as JSON (`autoindex_format json`, listings `no-cache`); compose mounts `/srv/video-editor/library` read-only; the deploy job creates `library/{stickers,sounds,overlays}`. In dev/preview a Vite plugin serves the same listing from `public/library` (git-ignored, never built). See DEPLOY.md, "Media library".
- Left panel tabs are now two compact rows with icons; on phones the bottom bar groups them (Media, Subtitles, Library, Effects, Properties). The Text/shape track is now labelled **Graphics** (so it is not confused with the Overlays pane).

### Verified
- 190 unit tests (adds the blend formulas, lookup clamping, Lighter Color, Dissolve proportion and stability, listing parsing with categories/hidden/other files/numeric sort/Persian names, 404 and HTML → unavailable, URL encoding, GIF frame timing incl. loop and rounding).
- **E2E `e2e/library.spec.ts`** (mocked server in nginx JSON format): two stickers (one in a category, a .txt ignored); click adds a 35 % sticker remembered as a library asset; the 2-frame GIF shows red / green / red at 0.25 / 0.75 / 1.25 s; adding it again reuses the asset; a sound dragged onto the audio lane at 2 s while still downloading lands at 2 s; an overlay goes on a new video track with Screen (blue screened over red = 255,64,255); the export shows the same GIF frames. A server without the folder shows how to add files.
- Canvas E2E now also checks Subtract (per-pixel table): preview (218,0,0) = export (219,0,0).
- Dev listing checked by hand with a Persian folder name and a file name with a space.

## Post-MVP 4 — Effects, adjustment layers, filters ✅ (2026-10-21)

### Done
- **Effect stack per clip** (`Clip.effects`, `model/effects.ts`): video, image, text and shape clips carry an ordered list of effects (on/off, reorder ↑↓, reset ↺, remove ✕, all settings in the inspector; every change is undoable with one step per slider drag). An **fx** badge on the timeline clip counts them.
- **Engine** (`engine/effects/`): WebGL2 on an OffscreenCanvas, so the export worker runs the very same passes. The clip is drawn into its layer, each effect is one or more full-screen shader passes (half-float targets when available), the result goes back into the layer and is blended with the clip's blend mode. Sizes are in project pixels and scale with the preview zoom and export resolution. Without WebGL2 effects are skipped with one console warning.
- **Effects pane** — After Effects' menu, 44 working effects:
  - Blur & Sharpen: Gaussian Blur, Fast Box Blur, Camera Lens Blur (disc/hexagon bokeh with highlight boost), Directional Blur, Sharpen, Unsharp Mask
  - Color Correction: Lumetri Color (exposure, contrast, highlights, shadows, whites, blacks, temperature, tint, saturation, vibrance, vignette), Curves (5-point, monotone, RGB or one channel), Levels, Hue/Saturation (with colorize), Tint, Tritone, Brightness & Contrast
  - Distort: Transform (position, scale, rotation, skew, opacity), Turbulent Displace (animated fractal noise), Displacement Map (from the layer below or itself), Optics Compensation, CC Power Pin (4-corner homography)
  - Generate: Fill, Gradient Ramp, 4-Color Gradient, Grid, Lens Flare, Stroke
  - Stylize: Glow, Drop Shadow, Motion Tile, Roughen Edges, Find Edges, Posterize
  - Perspective: Bevel Alpha, CC Sphere, Drop Shadow
  - Time: Echo (past frames, 6 operators), Posterize Time
  - Simulation: CC Particle World, CC Particle Systems II (closed-form particles, deterministic for any frame)
  - Keying: Linear Color Key (with spill suppression), Color Range
  - Transition: Linear Wipe, Radial Wipe, Venetian Blinds, Block Dissolve, Gradient Wipe — with "animate over the clip" (reveal at the start / wipe away at the end) since there are no keyframes yet.
  - Listed as **"soon"** and not addable: Warp Stabilizer, 3D Camera Tracker, Timewarp, CC Force Motion Blur, Shatter, Keylight (1.2).
  - Click adds to the selected clips; with nothing selected it creates an **adjustment layer** at the playhead. Drag an effect onto a clip on the timeline to add it there.
- **Adjustment layers** (`Clip.adjustment`, on Graphics tracks, "◫ Adjustment layer" button in the Effects pane): the composite below is run through the layer's effects and mixed back with its opacity and blend mode while it is on screen.
- **Filters pane** (`model/looks.ts`): 40 looks in the 7 requested groups (Noir and VHS appear twice, as asked) — colour grade, split toning, mono mixes, teal & orange, fade/matte, vignette, grain, soft focus, glow, sharpen, chromatic fringes, VHS (wobble, scanlines, bleed), glitch (block shifts), old film (flicker, dust, scratches). Thumbnails are rendered with the real shader from the current preview frame (or a sample scene). A clip has one filter: picking another changes it and keeps the intensity (0–100 %, in the inspector). Filters are an effect in the stack, so they also work on adjustment layers.
- Left panel: **Effects** and **Filters** tabs; on phones they are in the Effects group of the bottom bar with Transitions.

### Verified
- 201 unit tests (adds: catalog shape, every default in range, every name/parameter/option translated, filters menu, effects + adjustment layers through validation, one-filter-per-clip, reorder, wipe animation timing, monotone curves, levels, corner-pin homography, transform matrix, deterministic particles).
- In the browser: all 44 effects and all 40 filters compile and render on a clip; an adjustment layer with Hue/Saturation + Echo renders across frames.
- **E2E `e2e/effects.spec.ts`**: Brightness & Contrast added to a selected red clip; three adjustment layers made with nothing selected — Hue +120° (red → green), the Mono filter (grey), Fill blue; Gaussian Blur dragged onto the clip; removing an effect and undo. **Preview = export** at each layer: (0,155,0)/(0,155,1), (46,46,46)/(45,45,45), (0,0,255)/(1,0,255). Linear Wipe "reveal at the start" hides the square at 0 s and shows it at 1.5 s; "soon" effects are disabled.

### Known issues / not done
- No keyframes: effect settings are constant over a clip (transition effects have the start/end animation instead).
- Echo uses frames rendered earlier in the same pass (playback, export); after a seek, echoes build up again over the next frames. Positive echo times (future frames) are ignored.
- Effects work in frame space (the layer is the whole frame), not in each clip's own bounds: generators (Gradient Ramp, Grid, 4-Color) fill the frame, and Transform/Power Pin move what is inside the frame.
- Keylight, Warp Stabilizer, 3D Camera Tracker, Timewarp, Force Motion Blur and Shatter need motion tracking, optical flow or 3D simulation; they are listed for later.
