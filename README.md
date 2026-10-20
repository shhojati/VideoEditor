# ویرایشگر ویدیو · Video Editor

A browser-based video editor (CapCut-style MVP) with first-class **Persian / RTL subtitles**. Everything runs in the browser, offline: media, speech-to-text and export never leave the device.

- Import video, audio and images; multi-track timeline with move, trim, split, ripple delete, snapping, copy/paste and undo/redo.
- Real-time preview (audio-clocked), text overlays with Persian fonts, transforms, crop, speed and volume/fades.
- Subtitles: cue editor, quality checks, SRT/VTT import and export (RTL-safe), styled burn-in, and **automatic subtitles with Whisper** (tiny/base/small, WebGPU or WASM).
- Export to MP4 (H.264 + AAC) at 720p/1080p, streamed to disk; AAC works even where the browser has no AAC encoder (bundled WASM fallback).
- Persian (default, RTL) and English UI.

## Quick start (development)

```bash
npm ci
node scripts/fetch-models.mjs   # optional: Whisper models for auto-subtitles (~1 GB, needs internet once)
npm run dev                     # http://localhost:5173
```

Requires the latest Chrome or Edge. If your C: drive is full, see the note in `docs/PROGRESS.md` (npm cache/TEMP on D:).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with COOP/COEP headers |
| `npm run build` | Typecheck + production build into `dist/` |
| `npm test` | Unit tests (Vitest) |
| `npm run e2e` | End-to-end tests against the dev server, using the installed Chrome. `STT_E2E=1` adds real speech-to-text; `EXPORT_PERF=1` adds the 2-minute export benchmark |
| `npm run e2e:prod` | Smoke + accessibility tests against the production build |
| `npm run ci` | Lint, typecheck, unit, E2E, production smoke — everything |

Do not edit source files while E2E tests run: they share the dev server, and hot reload restarts the page under test.

## Deploying

Static files only, but the server **must use HTTPS** and send **COOP/COEP** headers. See [docs/DEPLOY.md](docs/DEPLOY.md) for nginx / IIS / Apache configuration and a checklist.

## Documentation

- [docs/PROGRESS.md](docs/PROGRESS.md): what was built per phase, decisions, known issues, what is next.
- [docs/SPIKES.md](docs/SPIKES.md): Phase 0 feasibility results (decode, export, Persian text, Whisper).
- [docs/DEPLOY.md](docs/DEPLOY.md): deployment on the internal network.

## Architecture in one paragraph

The project is one serializable JSON document (`src/model`) edited only through `useProjectStore().edit()`, which records Immer patches for undo/redo and autosaves to IndexedDB. Original media is copied into the browser's private file system (OPFS). `renderFrame(project, t, ctx, frames)` (`src/engine/render`) draws a frame and is shared by the preview and the exporter, so preview equals export. Playback is clocked by Web Audio; heavy work runs in workers (`src/workers`: thumbnails/waveforms, speech-to-text, export).
