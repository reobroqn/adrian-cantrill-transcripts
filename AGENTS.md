## 🏗️ Modular Architecture

The codebase follows a service-oriented structure with clear separation between orchestration, domain logic, and utility functions.

### Entrypoint & Runners
- **`src/main.ts`**: The single CLI entrypoint. Orchestrates commands using `commander`.
- **`src/cli/`**: Implementation of CLI commands (`scrape.ts`, `play.ts`). These coordinate high-level service calls.

### Services (`src/services/browser/`)
Logic is partitioned into specialized sub-modules:
- **`core.ts`**: Browser primitives (launching, page creation, stealth setup, context management).
- **`auth.ts`**: Authentication logic (login, session capture, cookies).
- **`scraper/`**: Course discovery logic. Uses a 3-layer architecture:
    - `logic.ts`: Pure DOM-level extraction (runs in browser context).
    - `actions.ts`: Puppeteer driver for navigation and triggering extraction.
    - `index.ts`: Orchestrates the scraping process and manifest persistence.
- **`player/`**: Media processing and worker management.
    - `manifest.ts`: Logic for loading the manifest and building lecture queues.
    - `vtt.ts`: Interception of subtitle streams and transcript generation.
    - `pool.ts`: Orchestrates parallel worker processes.
    - `pipeline.ts`: End-to-end logic for processing a single lecture.
    - `actions/`: Low-level video and subtitle UI interactions.

### Utils & Config
- **`src/config.ts`**: Centralized configuration and environment validation.
- **`src/utils/fs.ts`**: Explicit, modular file system utilities (`readJsonFile`, `writeFileSafe`, etc.).
- **`src/utils/logger.ts`**: Standardized logging.
- **`src/types/`**: Centralized, domain-grouped TypeScript interfaces.

## 🚀 Key Workflows

- **Manifest Generation**: `npm run scrape` (Discovers sections, lectures, and URLs).
- **Transcript Capture**: `npm run play` (Processes the manifest, plays videos in parallel, captures VTT).

## 🛠️ Dev Guidelines
- **Functional First**: Prefer plain exported functions over complex classes.
- **Explicit Imports**: Always use named imports; avoid `import * as`.
- **Resource Safety**: Use `await using` (AsyncDisposable) for browser and page cleanup.
- **Service Independence**: Modules within `player` and `scraper` should own their specific data-handling logic.
