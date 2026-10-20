# Deploying on the internal network

The editor is a **static site**: no backend, no database. All processing (decoding, speech-to-text, export) runs in the user's browser, and media never leaves the device. Everything it needs (fonts, ONNX Runtime WASM, Whisper models) is served from the same origin. Nothing is fetched from the internet at runtime.

## Docker (Ubuntu server)

The `Dockerfile` builds the app and serves it with nginx using the headers below (`deploy/nginx.conf`). Models are not in the image: they live in a folder on the server that is mounted at `/models`. `deploy/docker-compose.yml` runs the app behind Caddy, which gets a Let's Encrypt certificate for your domain automatically.

On the server, in `/srv/video-editor`, put `docker-compose.yml`, `Caddyfile`, `scripts/fetch-models.mjs` (as `fetch-models.mjs`) and a `.env` made from `deploy/.env.example`. Then:

```bash
docker compose --profile tools run --rm fetch-models   # once: downloads ~1.1 GB into ./models
docker compose up -d
```

Ports 80 and 443 must be open, and the domain's DNS must point at the server.

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
