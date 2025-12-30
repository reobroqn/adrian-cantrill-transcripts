# Adrian Cantrill Transcript Automation - Project Overview

This project is a TypeScript-based automation tool designed to extract and process transcripts from Adrian Cantrill's AWS courses.

## 🏗️ Refactored Architecture

The codebase follows a clean, service-oriented architecture:

### 1. Core Services (`src/core/`)
- **`ConfigService.ts`**: Centralized configuration management (ENV variables, file paths).
- **`BrowserService.ts`**: Manages Puppeteer browser lifecycle and page creation.
- **`Logger.ts`**: Consistent logging system across the application.

### 2. Platform Layer (`src/platform/`)
- **`IPlatform.ts`**: Interface for course platforms (login, scraping).
- **`TeachablePlatform.ts`**: Implementation for Adrian Cantrill's course site.

### 3. Automator Logic (`src/automator/`)
- **`AutomationCoordinator.ts`**: The main orchestrator that binds platforms, browser, and processing.
- **`VideoPlayerController.ts`**: Encapsulates low-level video interactions (play, mute, wait for end).
- **`Player.ts`**: Entry point for playing videos and capturing transcripts.
- **`Scraper.ts`**: Entry point for scraping course manifests.

### 4. Processing Layer
- **`src/interceptor/VttInterceptor.ts`**: Captures VTT segments from network traffic.
- **`src/transcript/VttParser.ts`**: Parses raw VTT files into clean text transcripts.

## 🚀 Workflows

- **Scrape Manifest**: `npm run scrape`
- **Capture Transcripts**: `npm run play` (use `--batch-size` or `--session` for specific targets).

## 🛠️ Dev Notes
- **Extensibility**: To support a new platform, implement the `IPlatform` interface and register it in the coordinator.
- **Validation**: Environment variables are validated on startup via `ConfigService`.
