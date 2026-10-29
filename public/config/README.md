# Owner settings

These files are the defaults baked into the image. On the server, edit the copies in
`/srv/video-editor/config/` instead (mounted over this folder; changes apply on the next page load,
no redeploy). Invalid values fall back to the defaults below.

## watermark.json — drawn on every export from a Free account

| key | meaning |
| --- | --- |
| `enabled` | `false` turns the watermark off |
| `text` | text to draw (Persian works) |
| `image` | optional file name in this folder, e.g. `"watermark.png"`; drawn instead of the text |
| `position` | `top-left`, `top-right`, `bottom-left`, `bottom-right` or `center` |
| `opacity` | 0–1 |
| `size` | text / image height as a fraction of the video's short side (0.045 ≈ 49 px at 1080p) |
| `margin` | gap to the edges, same unit |
| `fontFamily`, `fontWeight` | one of the editor's fonts: Vazirmatn, Lalezar, Noto Naskh Arabic, Markazi Text, Inter |
| `color` | CSS colour of the text |
| `shadow` | soft shadow so the text reads on light video |

## pricing.json — what the upgrade dialog shows

| key | meaning |
| --- | --- |
| `telegram` | your Telegram username (without @); the "Message on Telegram" button opens it |
| `freeMaxSeconds` | longest video a Free account may export |
| `passes` | Pro passes: `months` and `priceToman` |
| `creditPacks` | AI chat credit packs: `credits` and `priceToman`. What a request costs is set on the server (`AI_MARKUP`, `AI_CREDITS_PER_USD`, see docs/DEPLOY.md) |
