# Drawing tools — build plan

Source: `vidora-drawing-tools-plan.md` (agent / MCP wish list, 2026-10-28).
Goal: the AI agent **and the user** can draw real illustrations (faces, characters, objects), not
only blocky figures. Every feature below has a UI. The MCP tool is a second way into the same
command, never the only one.

Questions for the owner are marked **[ASK]**. New ideas that were not in the source file are
marked **[IDEA]**.

---

## 0. What already exists (so we don't build it twice)

The source file says the agent only has rectangles and circles. The **app** already has much more.
Most of it is just not exposed through MCP yet.

| Source file asks for | Already in the app (UI) | Exposed to the agent? | Gap |
|---|---|---|---|
| `add_path` (curves) | Pen-drawn shapes, `ShapeKind 'path'`, Bézier `MaskVertex[]`, point editing, path keyframes (Post-MVP 27) | ❌ (`add_shape` has no `path`) | No SVG `d` input. **One subpath per clip**, so no holes and no `evenodd`. |
| Gradients | Linear/radial, 2 colours, angle (Post-MVP 29) | ❌ | Only 2 stops. Radial is always centred. No gradient on the stroke. No `#RRGGBBAA`. |
| Shadow | `shadowColor` + `shadowBlur`, offset fixed at 2 %. Drop Shadow effect. | ❌ | No offset X/Y. No alpha in the colour. Doesn't combine with a soft edge. |
| Line cap / join / dash | `cap`, `join`, `dash: solid/dash/dot` | ❌ | No custom dash array. |
| Grouping | Compound clips (make / open / break apart, Post-MVP 21). Parenting + null objects (Post-MVP 28). | ❌ | Break apart doesn't bake the compound's transform into its children. No "group" verb for the agent. |
| Layer order | Track ▲ / ▼ in the track header (Post-MVP 28) | ❌ | No per-clip "bring to front". No order inside a drawing. |
| Masks | Roto pen masks with add/subtract/intersect/difference, feather, expansion, tracking | ❌ | **No masking by another clip** (After Effects' track matte). |
| Path morph | Path keyframes (linear) | partly (`animate` has no path) | Morph has no ease. No draw-on (trim paths). No follow-path. |
| `import_asset` | Media bin import (png/jpg/webp/gif/bmp/avif) | ❌ | **No SVG.** The agent can't send a file. |
| Library | Server library panes (stickers, sounds, overlays, backgrounds, templates, fonts) | `list_library`, `add_library_item` | No **user** library ("save this as a sticker"). |

So the work splits into three kinds:

1. **Expose** what exists: schema plus command plus docs. Small.
2. **Extend** the shape model: multi-stop gradients, alpha, shadow offset, new kinds. Small to medium.
3. **New engine pieces**: vector layer with parts, SVG import, track matte, trim paths, follow
   path, user library. Medium to large.

---

## 1. Key design decision: how a "drawing" is stored — **decided 2026-10-28: A**

> The owner chose **A**: one shape clip per part, grouped with compound clips, as in the source
> file. The vector layer (B) is not built. D2 shrinks to "group polish". D3 makes N path clips
> inside a group. **D1 is done** (see PROGRESS.md, "Drawing D1").

A face drawn the way the source file suggests (one `add_path` per part, then `group_clips`) is
about 6 to 30 clips. Today each overlapping shape needs **its own track** (`add_shape` adds a track
when the time range is taken). A character would fill the timeline with 30 graphics tracks.
`add_svg editable:true` would make that worse.

Options:

| | A. Clips + compound (source file's plan) | B. **Vector layer** (After Effects shape layer with contents) — recommended | C. Clips + null parent |
|---|---|---|---|
| Storage | 1 clip per part, wrapped in a compound clip | 1 clip, `shape.parts[]` tree (groups + paths), each part with its own fill, stroke and transform | 1 clip per part, all parented to a null |
| Timeline | 1 compound (insides: N tracks) | 1 clip | N tracks |
| SVG import | N clips → compound | 1 clip, parts = SVG elements | N clips |
| Order of parts | Tracks inside the compound | Order in the Contents list | Tracks |
| Animate one part | Open the compound, keyframe the clip | Keyframes `part.<id>.x` etc. (like `fx.<id>.<param>`) | Keyframe the clip |
| Export worker | Already works | Our own renderer (Path2D works in workers) | Already works |
| Effort | Small | Medium–large | Small |

**Recommendation:** build **B, the vector layer**, as the home for drawings. Keep **A** (the
existing compound clip) as the way to group *whole clips*: a drawing plus a text plus a video. B
fixes the track explosion. It also gives multiple subpaths, holes and SVG import in one clip, and
matches what After Effects users expect (shape layer → Contents → Group → Path / Fill / Stroke).

The rest of the plan assumes B. If you choose A, phases 2 and 4 get smaller, and the
`part.*` items become compound plus clip operations.

---

## 2. Phases

Each step follows the per-feature checklist in §4: model + migration, preview = export renderer,
UI, MCP command, undo, tests, docs.

### Phase D1 — Expose and extend what exists (small, high value)

Lets the agent draw a decent face with *today's* engine.

1. **Paths through MCP**: `add_shape` gets `kind: 'path'` with `d` (SVG path data) **or**
   `points` (vertex list). `update_clip.shape` gets `d`, `closed`, `cap`, `join`, `dash`, `feather`,
   `shadow`, `gradient`.
   - New `lib/svgPath.ts`: parses `d` (M L H V C S Q T A Z, relative and absolute) into
     `MaskVertex[]`. Q and T become cubics. Arcs become cubics (≤ 90° per segment). Errors say where,
     e.g. "invalid path command at index 42". Max 20 000 characters.
   - It also writes back (`MaskVertex[]` → `d`), so `get_clip` returns `d` and the agent can read
     what it drew.
   - **UI:** Inspector → Shape → **Path** row: "Copy as SVG path" and "Paste SVG path" (paste into
     the selected path shape, or into nothing to make a new one).
2. **Colour with alpha**: `#RRGGBBAA` accepted everywhere a colour is (shapes, text, solids,
   agent schemas). Stored as is; `ColorField` gets an alpha slider. Migration not needed (old values
   are 6-digit).
3. **Shadow offset**: `shadow: { color, blur, x, y }` (px). The old `shadowColor/shadowBlur` migrate
   to it with the old 2 % offset. **UI:** Shadow section gets X / Y / angle-distance fields.
4. **Layer order for clips**: `reorder_clip { clipId, action: bringToFront | sendToBack | forward | backward } | { trackIndex }`.
   It moves the clip to the next visual track that is free at its time, and makes a new track when
   none is free.
   - **UI:** a right-click menu on timeline clips and on the preview → **Arrange**, plus After
     Effects' keys: Ctrl+] forward, Ctrl+[ backward, Ctrl+Shift+] front, Ctrl+Shift+[ back. Today
     `[` / `]` without Ctrl jump between keyframes, so no clash.
5. **Grouping verbs for the agent**, on the existing compound clips: `group_clips { clipIds, name }`
   and `ungroup { groupId }`.
   - Fix while doing it: **Break apart bakes the compound's transform and opacity into each child**,
     so ungrouping doesn't make things jump (today it doesn't). Same in the UI.
6. **Docs** for the agent (tool descriptions, `docs/MCP.md`): units and coordinate system, an
   example face.

**Done when:** the example face at the end of the source file can be drawn through MCP and grouped,
a snapshot shows it, and preview = export.

### Phase D2 — Vector layer (multi-part drawings)

1. **Model**: `ShapeProps.parts?: ShapePart[]` on a new `kind: 'vector'`.
   - `ShapePart = { id, name, kind: 'group', children } | { id, name, kind: 'path', path: Animated<MaskVertex[][]>, fill, stroke, … }`.
     Each part has a local transform (x/y/rotation/scale/opacity, anchor) and `hidden`.
   - A path holds **several subpaths** (`MaskVertex[][]`) and `fillRule: nonzero | evenodd`.
     That gives holes: donut, eye with pupil, letter O.
   - Old single `path` shapes stay as they are. "Convert to vector layer" wraps one.
2. **Renderer** (`engine/render/shapes.ts`): walks the parts tree with `Path2D`, the same code in the
   preview and the export worker. Cache Path2D objects per part and key.
3. **Keyframes**: properties `part.<id>.x/y/rotation/scale/opacity`, `part.<id>.fill.r/g/b`, and path
   keys per part (morph, as today). They show in the Keyframes section grouped by part.
4. **UI**:
   - **Inspector → Contents**: a tree (groups, paths) with drag to reorder, eye, rename, duplicate,
     delete, and "Group" (Ctrl+G) / "Ungroup" (Ctrl+Shift+G) for selected parts. Selecting a part
     shows *its* fill, stroke, gradient and transform below.
   - **Preview**: double-click a vector layer to **enter it** (like opening a compound). Then clicks
     select parts, handles move, scale and rotate the part, and point editing works on that part's
     path. Escape goes back out.
   - **Pen / Shape tools with a vector layer selected add a new part to it.** With a video or photo
     selected they still draw a mask. **[ASK — decision 2]** After Effects has a "Tool creates
     shape / mask" toggle in the tool bar. Do we want that toggle too, or is "depends on what is
     selected" enough?
5. **MCP**: `add_path` becomes "add a part to a vector layer, or a new one":
   `{ d, fill, stroke, …, layerId?, groupId?, name }`. Also `update_part`, `delete_part`,
   `reorder_part { partId, action }` and `group_parts`. `get_clip` lists the parts with their `d`.

**Done when:** a 20-part character is 1 clip on 1 track. You can enter it, select the arm, rotate it
about its shoulder anchor and keyframe that. Undo is one step per action, and preview = export.

### Phase D3 — SVG import

1. **Parser** (`lib/svgImport.ts`, DOMParser on the main thread): `path`, `rect`, `circle`,
   `ellipse`, `line`, `polyline`, `polygon`, `g` (with transforms), `fill` / `stroke` /
   `opacity` / `fill-rule` / `stroke-*` (attributes, `style`, simple `<style>` classes),
   `linearGradient` / `radialGradient`, `viewBox`, `use` (internal only).
   - Becomes a **vector layer** whose parts mirror the SVG's groups and elements, keeping ids and
     names.
   - **Sanitize**: never render the SVG markup itself. Only what we parse is kept, so scripts,
     `on*`, `foreignObject` and external hrefs can't run. Limit 500 KB and 5 000 elements.
   - **Not supported** (reported in a toast or agent message, not silently dropped): filters,
     patterns, masks/clipPaths (later via D5), embedded `<image>`, `<text>`. **[ASK — decision 3]**
     Should SVG `<text>` become separate text clips, or be skipped with a warning?
2. **Why not as a picture?** The export worker can't decode SVG (`createImageBitmap` doesn't take
   SVG, and there is no DOM in workers). Our own vector renderer stays sharp at any zoom and scale.
   So SVG always becomes a vector layer. "Editable or not" is only whether the Contents are shown
   unfolded.
3. **UI**: drop an `.svg` on the media bin, timeline or preview, or use Import. It goes in the media
   bin as a **drawing asset** (reusable: drag it again for another copy) and can be placed like a
   sticker. Also: **paste SVG text from the clipboard** (Ctrl+V on the preview) → new vector layer.
   That's how people bring art from Figma or Illustrator.
4. **MCP**: `add_svg { svg, start, duration, width?, height?, transform? }` → `{ id, parts, warnings }`.

### Phase D4 — Look: gradients, more shape kinds, dashes

1. **Gradients** become `{ type: linear | radial, angle, center, radius, stops: [{offset, color}] }`
   on fill **and** stroke, for shapes and vector parts. The old `{ kind, to, angle }` migrates to 2
   stops.
   - **UI:** a gradient bar in the inspector: click to add a stop, drag to move it, colour (with
     alpha) per stop, delete. Plus an **on-canvas gradient handle**: drag the start/end, or the
     centre/radius for radial, as in Figma.
   - Stops' colours can be keyframed (`fill.stop<n>.r/g/b/a`).
2. **New parametric kinds** (stay editable as numbers, and animatable):
   - `arc` (startAngle, endAngle, stroke only)
   - `pie` (startAngle, endAngle)
   - `ring` (innerRadius)
   - **UI:** the shapes menu, the shape tool row, Q's cycle. Angle fields plus on-canvas angle
     handles.
   - **[IDEA]** `arc` with keyframed `endAngle` is the classic progress ring or countdown. Add it as
     a template too.
3. **Points input** (no new kind): `customPolygon` and `polyline smooth` from the source file become
   path parts built from points. `smooth: true` uses Catmull-Rom to Bézier.
   - **UI:** Pen tool option "smooth" (curves through the clicked points without dragging handles).
4. **Custom dash**: `dash: number[]` plus dash offset (keyframable → "marching ants").
   - **UI:** a "Custom" choice in the dash picker, with dash / gap fields.
5. **Soft edge + shadow together** (known issue from Post-MVP 29): draw the shadow from the
   feathered fill layer.

### Phase D5 — Masks by another clip (track matte)

1. **Model**: `Clip.matte?: { clipId, mode: 'alpha' | 'alphaInverted' | 'luma' | 'lumaInverted' }`.
   The matte clip is hidden while used as one (After Effects' behaviour). It still exists, so you
   can animate it.
2. **Renderer**: draw the clip and its matte into layers, then composite with `destination-in` /
   `destination-out` (alpha) or a luma pass. Mattes work for any visual clip (video, text, shape,
   vector layer, compound). **Inside a vector layer**, a part can clip its siblings:
   `part.clip: true`, like a Figma mask group, for pupils in eyes and hair inside the head.
3. **UI**:
   - Inspector → Blending → **Track matte**: a picker of other visual clips plus a mode.
   - A matte badge on the timeline clip.
   - In Contents, a part's menu → "Use as mask for the parts above".
   - **[IDEA]** "Convert to mask" on a shape: copies its path into a roto mask on the clip below.
     This is the cheap, one-off version.
4. **MCP**: `set_mask { clipId, maskClipId, mode }` and `clear_mask`. For parts,
   `update_part { clip: true }`.

### Phase D6 — Path animation

1. **Ease on path keyframes** (mask and shape paths), using the same easing as other keyframes.
   This closes a known gap.
2. **Trim paths / draw-on** (After Effects' Trim Paths): `trim: { start, end, offset }` 0..1 per
   path part or shape, keyframable. This is the "hand-drawn line" reveal.
   - **UI:** a Trim Paths section with three sliders and keyframe diamonds. Plus a one-click
     **"Draw on" animation preset** (0 → 1 over N seconds).
3. **Follow path**: `motion.path = { clipId (shape or part), progress keyframes, orient }`. The
   clip's position follows the path; `orient` turns it along the path.
   - **UI:** Transform → "Follow path" with a pick-whip-style picker of shapes, progress keyframes
     and an Orient checkbox.
4. **Morph helper**: path keyframes need the same vertex count. When they don't match (common with
   agent-drawn paths), **resample both to the same count** instead of refusing. Say so in a toast.
5. **MCP**: `animate` accepts `path` (as `d`) per keyframe, `trim.start/end/offset`, and
   `followPath`.

### Phase D7 — Asset import for the agent, user library

1. **`import_asset`** for the agent, corrected for how Vidora works:
   - **`path` can't work.** The MCP server is remote, and the user's browser tab can't read
     arbitrary disk paths. Dropped.
   - **`data` (base64)**: the `/mcp` body limit is **1 MB** (nginx and `BODY_LIMITS`), and calls pass
     through the bridge's event stream. Options: (a) cap at ~700 KB of file per call, or
     (b) chunked upload: `import_asset { uploadId, chunk, index, last }`, joined in the tab. **[ASK — decision 4]**
     Is a ~700 KB cap enough (icons, logos, SVGs), or do we build chunks so the agent can send
     photos up to ~20 MB?
   - **`url`** (https only): the tab fetches it. That only works for CORS-open hosts, so it is
     best-effort.
   - The type is checked by magic bytes (PNG, JPEG, WebP, GIF, SVG text). The file goes into OPFS
     like any import. Returns `{ assetId, name, width, height }`.
   - **UI:** none new. It's the same import path, and the asset shows in the media bin with a small
     "added by AI" tag. **[IDEA]**
2. **My library** (save a drawing or group, reuse it in other projects):
   - **UI:** right-click a vector layer or compound → **Save to My library**. A **My library**
     section at the top of the Stickers pane lists them, with rename and delete.
   - **MCP**: `save_to_library { clipId, name }`. `list_library` / `add_library_item` include
     `kind: 'mine'`.
   - **[ASK — decision 5]** Where is it stored?
     - (a) **On this device only** (IndexedDB). Free, nothing on the 1 GB VPS.
     - (b) **On the account** (server, synced across devices). Needs server storage and quotas,
       so maybe Pro only.

     Recommendation: (a) now, with export/import of a library file. (b) later.

---

## 3. New ideas (not in the source file) **[IDEA]**

1. **Vector layer** as the drawing model (§1). This is the biggest one.
2. **Paste SVG from the clipboard** onto the preview (D3).
3. **Brush stroke → vector**: Inspector → Paint → "Convert strokes to shape". Each stroke's outline
   (already a polygon from perfect-freehand) is simplified into a vector part. Freehand sketching
   then becomes editable, recolourable art. Small, since the outline already exists.
4. **Eyedropper** in `ColorField`: pick a colour from the preview (EyeDropper API where available,
   otherwise sampled from our canvas).
5. **Draw-on preset** and **progress-ring template** (D4/D6).
6. **Grid and guides for drawing**: a toggleable grid and rulers on the preview, with snapping the
   pen points to the grid (Shift = 45° angles while drawing lines).
7. **Export a drawing**: right-click a vector layer → "Save as SVG" / "Save as PNG". These are
   round-trips with Figma.
8. **Agent self-check**: `snapshot` gets `clipId` + `solo: true`, which renders just that clip on a
   checkerboard and cropped to it. The agent can then check a drawing without the rest of the frame
   in the way. Small, and helps every drawing tool.
9. **Boolean operations** (union, subtract, intersect between two path parts). Useful but heavy
   (needs a path-clipping library). Later; `evenodd` and part masks cover most uses.
10. **After Effects Repeater** (copies of a part with offset, rotation and scale steps). It gives
    flowers, gears, dotted rings and patterns from one part. Medium. Later.

---

## 4. Checklist per feature (from the source file, adapted to this repo)

1. **Model**: `src/model/types.ts`, zod in `model/validate.ts`, bump `CURRENT_VERSION` and add a
   migration in `model/migrations.ts`. Older app versions refuse newer projects (as for paint).
2. **Renderer**: one drawing function in `engine/render/` used by `renderFrame` in both the preview
   and `export.worker.ts`, so preview ≠ export can't happen. Path2D and gradients work in
   OffscreenCanvas.
3. **UI**: inspector section, on-canvas handles where it makes sense, tool bar or menu entry, fa +
   en strings (RTL checked), and phone layout.
4. **MCP**: the command in `features/agent/commands.ts` with zod limits, then regenerate
   `server/src/agentTools.json` (`UPDATE_AGENT_TOOLS=1 npx vitest run src/features/agent`).
5. **Undo**: one `edit()` per action; drags use `gesture` merge.
6. **Tests**: unit tests (parser, geometry, migrations), plus an E2E spec with a **preview = export**
   pixel check, as the existing specs do.
7. **Docs**: `docs/PROGRESS.md` entry and `docs/MCP.md` tool notes.

---

## 5. Suggested order

| # | Step | Effort | Value | Why here |
|---|---|---|---|---|
| 1 | **D1** expose paths (`d`), alpha colours, shadow offset, `reorder_clip`, `group_clips`/`ungroup` (+ bake fix) | S–M | ★★★★★ | Agent can draw a face with today's engine |
| 2 | **D4.1** multi-stop gradients + gradient UI | S | ★★★ | Shading |
| 3 | **D2** vector layer + Contents panel + enter/edit on canvas | L | ★★★★★ | Ends the track explosion; base for 4–6 |
| 4 | **D3** SVG import (file, paste, `add_svg`) | M | ★★★★ | One-call illustrations; Figma round-trip |
| 5 | **D7.1** `import_asset` | S | ★★★ | Logos and icons from the agent |
| 6 | **D4.2–5** arc/pie/ring, smooth pen, custom dash, shadow + soft edge | S | ★★★ | Detail |
| 7 | **D5** track matte + part masks | L | ★★★ | Pupils, hair, reveals |
| 8 | **D6** eased morph, trim paths, follow path | L | ★★ | Motion design |
| 9 | **D7.2** My library | M | ★★ | Reuse across projects |
| — | Ideas 3, 4, 6, 7, 8 slotted in where they touch the same code | S each | | |

Minimum to draw a decent face: **step 1 + step 2**. Minimum to draw a *character* properly:
**steps 1 to 4**.

---

## 6. Open questions (summary) **[ASK]**

1. **Drawing model**: vector layer with parts (recommended), or one clip per part grouped in
   compounds (as in the source file)?
2. **Pen with a vector layer selected**: always add a part to it, or add an After Effects "creates
   shape / mask" toggle to the tool bar?
3. **SVG `<text>`**: turn into text clips, or skip with a warning?
4. **Agent file size**: ~700 KB per `import_asset` call, or chunked upload up to ~20 MB?
5. **My library**: device only (recommended for now), or synced to the account (maybe Pro)?
6. **Free vs Pro**: are all drawing tools Free? My assumption is yes, since they run in the browser.
   Should `add_svg` / `import_asset` for the agent follow the existing rule (all logged-in users)?
7. **Phone**: is entering a vector layer and editing points on a phone needed in the first version,
   or is the desktop enough with phones getting view + transform only?
