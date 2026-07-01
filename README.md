# Apex Slipstream

Imported from Playabl project:
https://playabl.ai/en/projects/6a41a9a750c4434de7e22681?view=game

## Run Locally

This project uses Vite.

```bash
pnpm install
pnpm run dev
```

Local URL:
http://localhost:5173/

## Public URL

Stable static URL:
https://raw.githack.com/Sigmahacks12/apex-slipstream-from-playabl/main/public-build/index.html

The committed `public-build/` folder is built with relative asset paths so it can be served from a GitHub-backed static URL without extra repository settings.

## Notes

- Source code lives in `src/game/game.js`.
- Game assets live in `generated-assets/`.
- The app was restored from the Playabl preview/code view and adjusted to run locally with normal package imports.
- Recommended upgrades added after import: moving traffic, powerups, close-miss bonuses, pause, customizable keybinds, difficulty modes, mute, and run stats.
