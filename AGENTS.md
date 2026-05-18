<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# AI Reader Agent Guide

## Project Goal

AI Reader is a local-first reading app built with Next.js and Electron. It supports PDF, EPUB, and TXT reading with AI explanation, translation, chat, and notes.

## Required Workflow

1. Read the relevant code before changing behavior. Prefer existing patterns over new abstractions.
2. For Next.js behavior, consult `node_modules/next/dist/docs/` first. This project uses Next.js 16.
3. Keep changes scoped to the requested feature or bug.
4. Run validation before handing off:

```bash
npm run lint
npm run build
```

5. If Electron behavior or packaged desktop output changed, also run:

```bash
npm run desktop:pack
```

The packaged app is written to:

```text
release/mac-arm64/AI Reader.app
```

## Development Commands

```bash
npm run dev              # Next.js dev server
npm run desktop          # Next.js dev server + Electron shell
npm run desktop:devtools # Electron shell with DevTools
npm run lint             # ESLint
npm run build            # production Next.js build
npm run desktop:pack     # macOS .app directory build
npm run desktop:dist     # dmg/zip distribution build
```

## Architecture Notes

- `src/app/library-inner.tsx`: library/import UI.
- `src/app/reader/[id]/reader-inner.tsx`: main reader state, toolbar, AI sidebar, notes, preferences.
- `src/app/reader/[id]/PDFViewer.tsx`: PDF rendering and selection handling.
- `src/app/reader/[id]/EpubViewer.tsx`: EPUB rendering through `epubjs`.
- `src/utils/storage.ts`: book metadata, file payloads, notes, progress, reader preferences.
- `electron/main.cjs`: Electron window, menus, app-local file persistence, packaged Next server.
- `electron/preload.cjs`: safe desktop bridge exposed to the renderer.

## EPUB Rules

- EPUB content is rendered inside an iframe. Outer Tailwind classes do not affect book text.
- Theme, font size, font family, word spacing, selection color, and code styles must be injected through `epubjs` content stylesheet rules.
- Width changes from sidebar toggles or drag resizing must preserve the current CFI. Avoid repeatedly calling `display()` during every resize event; debounce resize restoration so continuous drags do not jump back to an old location.
- When adding EPUB reading controls, pass state from `reader-inner.tsx` into `EpubViewer.tsx` and persist user preferences through `ReaderPreferences`.

## Electron Rules

- The desktop app persists imported books under Electron `userData`.
- Do not remove IndexedDB fallback behavior; it is still used by the browser development path.
- After changes to Electron, storage, packaging, or production-only behavior, rebuild with `npm run desktop:pack` and test the packaged app.

## UI Verification Checklist

For reader UI changes, manually verify the relevant formats:

- PDF: load, zoom, page controls, outline, selection menu.
- EPUB: theme, font size, font family, word spacing, sidebar open/close, drag resize, reading position stability.
- TXT: theme, font size, scrolling.
- AI sidebar: chat tab, notes tab, config panel, search input, bottom input.

## Editing Constraints

- Preserve user data and existing worktree changes.
- Do not run destructive git commands.
- Use `apply_patch` for manual file edits.
- Keep comments minimal and only where they clarify non-obvious behavior.
