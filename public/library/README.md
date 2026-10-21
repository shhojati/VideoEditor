# Local media library

Files here show up in the Stickers, Sound effects and Overlays panes while developing
(`npm run dev` / `npm run preview` list this folder the way nginx lists the server's).

    public/library/stickers/   .png .gif        (subfolders = categories)
    public/library/sounds/     .ogg .mp3
    public/library/overlays/   .mp4 .webm .mov

Everything except this README is git-ignored and never built into the app. On the server the
same folders live in /srv/video-editor/library (see docs/DEPLOY.md).
