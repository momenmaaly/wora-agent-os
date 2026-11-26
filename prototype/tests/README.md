# Prototype verification

These scripts drive the real static prototype in Chromium. They do not call a backend mutation.

| Script | What it checks |
|---|---|
| `smoke.cjs` | 16 routes at 390px and 1440px, route identity, overflow, direction, accessible names, palette, approval sheet, focus return, keyboard tabs |
| `responsive.cjs` | four representative routes at 1920, 1440, 1280, 1101, 1024, 900, 768, and 390px |
| `capture-screenshots.cjs` | regenerates the review screenshots in `docs/experience-redesign/screenshots/` |

## Run

```bash
cd prototype
python3 -m http.server 8123

# from the repository root, in another shell
PLAYWRIGHT_PKG=/path/to/playwright node prototype/tests/smoke.cjs
PLAYWRIGHT_PKG=/path/to/playwright node prototype/tests/responsive.cjs
PLAYWRIGHT_PKG=/path/to/playwright node prototype/tests/capture-screenshots.cjs
```

Environment overrides:

- `WORA_PROTO_BASE` — prototype URL (default `http://127.0.0.1:8123/index.html`).
- `PLAYWRIGHT_PKG` — path or package name that exports `chromium`.
- `CHROMIUM_PATH` — browser binary (default `/usr/bin/chromium`).
- `WORA_SCREENSHOT_DIR` — screenshot output directory.

Recorded result: `smoke.cjs` 42/42 and `responsive.cjs` 32/32, failures 0.
