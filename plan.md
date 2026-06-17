# Project Pivot: Browser Extension Transition

This document tracks the migration from a Puppeteer-based CLI scraper to a Manifest V3 Browser Extension to bypass CAPTCHA and bot detection.

## Architecture Overview

- **Platform:** Chrome Extension (Manifest V3)
- **Primary Language:** TypeScript
- **Bundler:** Vite (to compile TS and bundle existing logic)
- **Data Persistence:** Browser Downloads API (saving transcripts as .txt or .zip)

## Core Components

### 1. Content Script
- Runs on `learn.cantrill.io`.
- Scrapes course curriculum (Manifest).
- Injects a "Sync/Start" UI overlay into the Teachable dashboard.
- Handles automated navigation (moving between lectures).

### 2. Background Service Worker
- Intercepts network requests to capture English `.webvtt` files from Hotmart/Teachable.
- Manages the state of the scraping session across multiple pages.
- Coordinates between the Content Script and the Downloads API.

### 3. Processing Engine (Migrated)
- Port existing `vtt.ts` logic to run in the browser context.
- Aggregate VTT segments into prose transcripts.

---

## Migration Roadmap

### Phase 1: Infrastructure & Scaffolding [x]
- [x] Initialize Vite/TypeScript build for extension.
- [x] Create `manifest.json` (V3).
- [x] Setup folder structure (`src/extension/content`, `src/extension/background`).

### Phase 2: Manifest Extraction [x]
- [x] Port `src/services/browser/scraper/logic.ts` to Content Script.
- [x] Implement UI button to trigger "Scan Course Structure".
- [x] Verify course manifest can be generated in-browser.
- [x] Add logging to Background Worker for manifest storage verification.

### Phase 3: Network Interception & Direct Fetching [x]
- [x] Implement `chrome.webRequest` in Background Worker to catch VTT/M3U8 URLs.
- [x] Update logic to prefer "Direct Fetching" (capturing `master.m3u8` and fetching all segments at once).
- [x] Improve Video ID detection in Content Script.

### Phase 4: Automation & Transcription [x]
- [x] Implement "Auto-advance" logic (click "Next" and wait for page load).
- [x] Implement "Bulk Scrape" (Auto-advance through all lectures in the manifest).
- [x] Port `processTranscripts` to generate final text in the browser.
- [x] Implement File Download (Saving the .txt files).

### Phase 5: Cleanup [x]
- [x] Remove Puppeteer and CLI-specific dependencies.
- [x] Update `README.md` with extension installation instructions.
- [x] Final end-to-end verification.

### Phase 6: Performance & UX Improvements [x]
- [x] Run bulk scrape in an inactive background tab so user stays on their current page.
- [x] Upgrade bulk scrape from sequential (1 tab) to concurrent batch processing (3 parallel tabs).
  - New `BulkState` tracks `tabToIndex` map, `nextIndex` cursor, and `completedCount`.
  - Each worker tab independently claims the next queue item upon completion.
  - All worker tabs close automatically when the queue is exhausted or cancelled.
  - Cancellation now closes all active worker tabs simultaneously.

---

## Status Log
- **2026-05-20**: Initialized pivot plan. Moving from CLI to Extension.
- **2026-05-22**: 
  - Encountered and fixed "No video ID" bug by supporting `/embed/` paths in Hotmart iframes.
  - Implemented background fallback for Video ID: Content script now queries background worker for `lastCapturedVideoId` if DOM scraping fails.
  - Improved UX: Added `console.table` logging in the main page console for manifest extraction.
  - Resolved build environment issue (PowerShell execution policy bypass).
  - Verified "Direct Fetching" strategy logic is ready for end-to-end test.
- **2026-05-24**:
  - **Attempt 1 (Service Worker Blob URL):** Attempted creating Blob URLs in the background service worker. Failed because `URL.createObjectURL` is undefined in service workers.
  - **Attempt 2 (Service Worker Data URI):** Attempted `chrome.downloads.download` with `data:` URLs. Confirmed it triggers correct browser download behavior, but Playwright debugging environment intercepts and renames the files to random UUIDs.
  - **Attempt 3 (Content Script DOM Blob URL):** Attempted returning the prose to the content script to trigger DOM clicks via Blob URLs. 
  - **Pivot Solution:** Pivot back to the simpler direct background downloads (Attempt 2) since we verified the data URI downloads work perfectly in normal browser runs (and Playwright's interception was the cause of the UUID naming). Deleted temporary `download.html` / `download.ts` files to simplify and clean the codebase.
- **2026-05-25**:
  - Moved bulk scrape automation to an inactive background tab so the user's active page is never navigated away.
  - Upgraded bulk scraper from single sequential tab to a concurrent batch architecture (`BULK_CONCURRENCY = 3`). Each worker tab runs independently and self-schedules the next lecture, giving ~3x throughput without triggering CDN rate limits.
- **2026-06-17**:
  - Implemented direct fetching hot-fix to resolve issues where the CDN would return `403 Forbidden` due to subdomains like `*.play.hotmart.com` not being covered in MV3 host permissions.
  - Stripped tokenized query parameters containing slashes from `masterUrl` and `subtitleUrl` before extracting base directories to avoid directory corruption during direct downloads.


