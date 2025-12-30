# Adrian Cantrill Transcript Automation - Project Overview

This project is a TypeScript-based automation tool designed to extract and process transcripts from Adrian Cantrill's AWS courses. It leverages Puppeteer for browser automation and custom logic for VTT (WebVTT) interception and parsing.

## 🏗️ Project Architecture

The codebase is organized into a clean, modular structure:

### 1. Automator (`src/automator/`)
Handles the heavy lifting of browser interaction.
- **`Scraper.ts`**: The entry point for crawling the course syllabus. It extracts sections and lecture metadata (titles, URLs) and saves them to `data/course_manifest.json`.
- **`Player.ts`**: The core execution engine. It iterates through the manifest, navigates to lecture pages, and plays videos to trigger VTT network requests.
- **`BaseAutomator.ts`**: Provides a common foundation for both the Scraper and Player, including session management (login), browser initialization, and utility methods.

### 2. Interceptor (`src/interceptor/`)
Focuses on capturing real-time network traffic.
- **`VttInterceptor.ts`**: Hooks into the Puppeteer page to watch for outgoing requests for `.vtt` files. It captures the VTT content as it streams in from the CDN.

### 3. Transcript Processing (`src/transcript/`)
Converts raw subtitle data into readable formats.
- **`VttParser.ts`**: Contains logic to clean up VTT formatting, remove timestamps, and join segments into a coherent text body.
- **`helpers.ts`**: Utility functions for file path management and text sanitization.

### 4. Data Storage (`data/`)
- `course_manifest.json`: The source of truth for the course structure.
- `vtt_segments/`: Cached raw VTT data intercepted during playback.
- `transcripts/`: The final output - clean text files organized by course section.

## 🚀 Key Workflows

### Phase 1: Scraping
Run `npm run scrape` to generate the `course_manifest.json`. This requires a valid login session.

### Phase 2: Playing & Intercepting
Run `npm run play` (or `npm run play -- --batch-size X`) to start the browser. The script will:
1. Log in to the course platform.
2. Load lectures one by one.
3. Use the `VttInterceptor` to grab the subtitle streams.
4. Pass the data to the `VttParser`.

## 🛠️ Tech Stack
- **Runtime**: Node.js
- **Language**: TypeScript
- **Automation**: Puppeteer (with `puppeteer-extra-plugin-stealth`)
- **Linting/Formatting**: Biome
- **Transpilation**: `ts-node` for development, `tsc` for builds.

## 📝 Usage Notes for Agents
- **Environment Variables**: Ensure `EMAIL`, `PASSWORD`, and `COURSE_ID` are set in `.env` at the root.
- **Authentication**: The automator handles login via `BaseAutomator.ts`. It uses a profile directory to persist cookies where possible.
- **Headless Mode**: Use `--debug` flag in scripts to toggle headless mode off for visual debugging.
