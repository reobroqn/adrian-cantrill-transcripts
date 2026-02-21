## 🏗️ Simplified Architecture

The codebase follows a flat, functional module structure with entrypoints in `src/` and helpers in `src/helpers/`:

### Entrypoints
- **`src/scrape.ts`**: CLI entrypoint for scraping course manifests (`npm run scrape`).
- **`src/play.ts`**: CLI entrypoint for playing videos and generating transcripts (`npm run play`).

### Supporting Modules (`src/helpers/`)
- **`config.ts`**: Plain exported configuration object (ENV variables, file paths).
- **`logger.ts`**: Simple logging utilities.
- **`types.ts`**: Shared TypeScript interfaces (Lecture, Section, Manifest, VttSegment).
- **`browser.ts`**: Functions for launching Puppeteer, creating pages, and closing browser.
- **`teachable.ts`**: Functions for Teachable platform (login, isLoggedIn, scrapeCourse).
- **`player.ts`**: Functions for video control (findVideoFrame, ensurePlaying, waitForFinished).
- **`vtt.ts`**: VTT interception, parsing, and transcript generation.

## 🚀 Workflows

- **Scrape Manifest**: `npm run scrape`
- **Capture Transcripts**: `npm run play` (use `--session` for specific targets, and configure `BATCH_SIZE`, `CONCURRENCY`, `SEEK` in `.env`).

## 🛠️ Dev Notes
- **No Classes**: All modules export plain functions — no singletons, no coordinators, no interfaces.
- **Structure**: High-level orchestration in the entrypoints, all reusable logic in `helpers/`.
