# Deploying on the internal network

The editor is a **static site** plus a small **account API** (`server/`: email + password accounts and Pro passes, stored in SQLite). All processing (decoding, speech-to-text, export) runs in the user's browser, and media never leaves the device. Everything it needs (fonts, ONNX Runtime WASM, Whisper models) is served from the same origin. Nothing is fetched from the internet at runtime. Without the API the editor still opens and edits; only export (which needs an account) is unavailable.

## Docker (Ubuntu server)

The `Dockerfile` builds the app and serves it with nginx using the headers below (`deploy/nginx.conf`). Models are not in the image: they live in a folder on the server that is mounted at `/models`. `deploy/docker-compose.yml` publishes the app on `127.0.0.1:${APP_PORT}` (default 8081) only; the server's existing web server handles HTTPS for the domain and proxies to it. `.github/workflows/deploy.yml` builds the image on every push to `main` and rolls it out over SSH.

On the server, in `/srv/video-editor`, put `docker-compose.yml`, `scripts/fetch-models.mjs` (as `fetch-models.mjs`) and a `.env` made from `deploy/.env.example`. Then:

```bash
docker compose --profile tools run --rm fetch-models   # once: downloads ~1.1 GB into ./models
docker compose up -d
```

Add a site to the host's Caddy (`/etc/caddy/Caddyfile`) and reload it with `sudo systemctl reload caddy`; Caddy gets the certificate itself:

```
editor.example.com {
    reverse_proxy 127.0.0.1:8081
}
```

The app container already sends the COOP/COEP headers and MIME types; the proxy passes them through unchanged.

### Media library (Stickers, Sound effects, Overlays panes)

The library panes list files from `/srv/video-editor/library`, mounted read-only into the container at `/library` (`deploy/docker-compose.yml`). nginx lists each folder as JSON (`autoindex_format json`), so adding a file is all it takes; there is no manifest. One level of subfolders becomes categories in the pane.

```
/srv/video-editor/library/
  stickers/    .png .gif (animated GIFs play and loop)    e.g. stickers/emoji/smile.gif
  sounds/      .ogg .mp3                                  e.g. sounds/whoosh/fast.mp3
  overlays/    .mp4 .webm .mov (short clips; added with blend mode Screen, so shoot them on black)
```

```bash
mkdir -p /srv/video-editor/library/{stickers,sounds,overlays}
docker compose up -d   # once, after the volume was added to docker-compose.yml
```

Files must be readable by the container (`chmod -R a+rX library`). Names may contain spaces and Persian letters. Users see new files after reopening the pane (⟳). A file is downloaded into the user's browser the first time it is used in a project.

### Accounts, Free and Pro

- Anyone can open the editor, edit and preview without an account. **Exporting needs an account.**
- **Free** accounts export videos up to `freeMaxSeconds` (60 s) and every export carries the watermark.
- **Pro** (prepaid passes of 1/3/12 months, no auto-renew): any length, no watermark. Pro ends by itself when the pass runs out.
- Payment is manual: the account dialog shows the user's account code (`U-1042`), the prices and a "Message on Telegram" button. After they pay, activate Pro on the admin page.

The `api` service (`server/Dockerfile`, image `ghcr.io/shhojati/videoeditor-api`) is not published; nginx in the `app` container proxies `/api/` to it, so it is same-origin with the editor. Its database is `/srv/video-editor/data/app.db`.

First time, on the server:

```bash
cd /srv/video-editor
docker compose up -d
# Register your own account in the editor (Log in → Create account), then make it an admin:
docker compose exec api node src/cli.ts make-admin you@example.com
```

Admin page: `https://editor.example.com/admin` — search accounts by email or code, **Activate Pro** (months, amount paid, note: the amount is kept for your records), **End Pro now**, **Reset password** (gives a temporary password to send the user; there is no email reset).

**Owner settings** live in `/srv/video-editor/config/` (mounted at `/config/`; the deploy copies defaults in once and never overwrites them): `watermark.json` (text or image, position, size, opacity…) and `pricing.json` (Telegram username, Free length limit, passes and prices). Every key is described in `public/config/README.md`. Edits apply on the next page load, no restart. For an image watermark, put e.g. `watermark.png` in that folder and set `"image": "watermark.png"`.

**Back up** `data/app.db` (e.g. a nightly `sqlite3 data/app.db ".backup /backups/app-$(date +%F).db"` or simply copying `data/` while the API is stopped). Losing it loses every account and Pro pass.

The free-plan limits are applied in the user's browser, so a technical user could patch them out; the API is the source of truth for who is Pro.

## 1. Build

On a machine with Node 20+ and access to the npm mirror:

```bash
npm ci
node scripts/fetch-models.mjs        # once, on a machine that can reach huggingface.co (or set HF_ENDPOINT to a mirror)
npm run build                        # -> dist/
```

`dist/` contains the app (~55 MB) plus `dist/models/` (Whisper tiny/base/small, ~1.1 GB). Copy the whole folder to the web server. To save space, delete model sizes you do not want from `public/models/` before building (the app shows missing models as "not installed").

## 2. Server requirements

| Requirement | Why |
|---|---|
| **HTTPS** (or `localhost`) | WebCodecs, OPFS and `SharedArrayBuffer` only exist in a *secure context*. Over plain `http://10.x.x.x` the app shows "This browser cannot run the editor". An internal CA certificate is fine. |
| `Cross-Origin-Opener-Policy: same-origin` | Cross-origin isolation, needed for multi-threaded speech-to-text. |
| `Cross-Origin-Embedder-Policy: require-corp` | Same. Without these two headers the app still works, but auto-subtitles run single-threaded (much slower), and a notice says so. |
| MIME types: `.wasm` → `application/wasm`, `.mjs` → `text/javascript`, `.onnx` → `application/octet-stream`, `.woff2` → `font/woff2` | Browsers refuse to compile WASM or import modules with a wrong type. |
| Fallback to `index.html` is **not** needed | The app has a single page. Do **not** rewrite unknown paths to `index.html`: a missing model file must return 404 so the app can report it. |

Recommended caching: `index.html` → `no-cache`; `assets/*` (hashed names) → `max-age=31536000, immutable`; `models/`, `wasm/`, `fonts/` → long `max-age` (they change rarely).

### nginx

```nginx
server {
    listen 443 ssl;
    server_name video-editor.internal;
    ssl_certificate     /etc/ssl/internal/video-editor.crt;
    ssl_certificate_key /etc/ssl/internal/video-editor.key;

    root /srv/video-editor/dist;
    index index.html;

    add_header Cross-Origin-Opener-Policy  same-origin   always;
    add_header Cross-Origin-Embedder-Policy require-corp always;

    types {
        application/wasm          wasm;
        text/javascript           js mjs;
        application/octet-stream  onnx;
        font/woff2                woff2;
    }
    include /etc/nginx/mime.types;

    location = /index.html { add_header Cache-Control "no-cache"; add_header Cross-Origin-Opener-Policy same-origin always; add_header Cross-Origin-Embedder-Policy require-corp always; }
    location /assets/       { add_header Cache-Control "public, max-age=31536000, immutable"; add_header Cross-Origin-Opener-Policy same-origin always; add_header Cross-Origin-Embedder-Policy require-corp always; }
    location / { try_files $uri =404; }
}
```

(nginx does not inherit `add_header` into a `location` that sets its own headers, hence the repetition.)

### IIS (`web.config` in `dist/`)

```xml
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <system.webServer>
    <httpProtocol>
      <customHeaders>
        <add name="Cross-Origin-Opener-Policy" value="same-origin" />
        <add name="Cross-Origin-Embedder-Policy" value="require-corp" />
      </customHeaders>
    </httpProtocol>
    <staticContent>
      <remove fileExtension=".wasm" /><mimeMap fileExtension=".wasm" mimeType="application/wasm" />
      <remove fileExtension=".mjs" /><mimeMap fileExtension=".mjs" mimeType="text/javascript" />
      <remove fileExtension=".onnx" /><mimeMap fileExtension=".onnx" mimeType="application/octet-stream" />
      <remove fileExtension=".woff2" /><mimeMap fileExtension=".woff2" mimeType="font/woff2" />
    </staticContent>
    <security>
      <!-- model files are ~400 MB; raise the static file limit if your IIS version enforces one -->
      <requestFiltering><requestLimits maxAllowedContentLength="1073741824" /></requestFiltering>
    </security>
  </system.webServer>
</configuration>
```

### Apache (`.htaccess` or vhost)

```apache
Header always set Cross-Origin-Opener-Policy "same-origin"
Header always set Cross-Origin-Embedder-Policy "require-corp"
AddType application/wasm .wasm
AddType text/javascript .mjs
AddType application/octet-stream .onnx
AddType font/woff2 .woff2
```

### Quick local check

```bash
npm run build && npx vite preview --port 4173
```

`vite preview` sends the right headers; open <http://localhost:4173>.

## 3. Verify a deployment

1. Open the site in Chrome or Edge. No red "cannot run" page; the amber notice lists only things you accept (for example, no WebGPU on a VM).
2. DevTools → Console: `crossOriginIsolated` is `true`.
3. DevTools → Network, filter "domain:" — every request goes to the editor's own host.
4. Subtitles tab → Auto subtitles: the model list shows ✓ for the models you installed.
5. Load the sample project and export it.

## 4. Browser support

Latest **Chrome** or **Edge** on desktop (WebCodecs, OPFS, File System Access, WebGPU). Exports always get AAC audio: if the browser or Windows edition has no AAC encoder (e.g. Windows N without the Media Feature Pack), a built-in WebAssembly encoder is used automatically. Firefox and Safari are not supported in the MVP; they get the "cannot run" page or a limited-support notice. Users' media is stored in the browser profile (OPFS); clearing site data removes it. The editor then shows those files as missing and offers to relink them.
