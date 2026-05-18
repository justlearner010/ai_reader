# AI Reader mac App Roadmap

## Current direction

AI Reader is still a Next.js app, but the mac build now has a desktop shell through Electron. This keeps the existing reader, storage, and API routes working while we raise the product quality in focused steps.

Tauri is still a good future option for a smaller binary. The current machine does not have Rust/Cargo installed, and the app still depends on runtime Next routes, so Electron is the fastest first mac milestone.

## Milestone 1: desktop shell

- Open the app in a native macOS window.
- Keep renderer security tight: no Node integration, context isolation enabled.
- Preserve current Next server behavior for AI routes and dynamic reader URLs.
- Add native menu items for edit, view, window, and quit actions.

Run locally:

```bash
npm run desktop:dev
```

The desktop scripts set `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` for Electron startup and packaging so first-run binary downloads do not stall on the default upstream mirror.

Create a packaged mac build:

```bash
npm run desktop:dist
```

Unsigned builds are fine for local testing. Distribution to other Macs will need Developer ID signing and notarization.

## Milestone 2: app-grade reading workflow

- Move import into a dedicated flow with drag-and-drop, duplicate detection, and import progress.
- Add global search across title, notes, and extracted text.
- Add stable note anchors for PDF pages and EPUB CFI locations.
- Add keyboard shortcuts for library, sidebar, search, note creation, and AI actions.

## Milestone 3: local-first data model

- Replace browser-only storage as the long-term source of truth with an app data directory.
- Store original files, metadata, extracted text, covers, notes, and AI settings separately.
- Add backup/export and restore.
- Keep privacy defaults explicit: local files stay local unless the user sends selected context to an AI provider.

## Milestone 4: native polish

- Add a real app icon, about panel, file-open handler, and recent documents support.
- Add automatic update strategy.
- Add mac signing and notarization.
- Decide whether to keep Electron or move to Tauri once the runtime architecture is stable.
