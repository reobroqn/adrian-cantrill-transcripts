# Adrian Cantrill Transcript Automation

This project automates the generation of transcripts for Adrian Cantrill's AWS courses by scraping lecture metadata, playing videos to extract VTT links, and converting them to clean text.

## 🏗️ Architecture Overview

The project follows a clean, modular TypeScript architecture:
- **Core Services**: Centralized management of configuration, browser lifecycle, and logging.
- **Platform Abstraction**: Isolated logic for specifically targeting the Teachable platform.
- **Automation Logic**: A coordinator-based approach to orchestrate scraping and playback.
- **Processing**: Real-time interception of VTT segments and post-processing into clean transcripts.

## 🚀 Setup & Usage

### 1. Prerequisites
- **Node.js**: v20+ recommended.
- **NPM**: Latest version.

### 2. Configuration
Create a `.env` file in the root directory:
```env
EMAIL=your_email@example.com
PASSWORD=your_password
COURSE_ID=1820301
# OPTIONAL: PROXY=http://user:pass@host:port
```

### 3. Installation
```bash
npm install
```

### 4. Running the Automation

#### Step 1: Scrape Course Manifest
Extracts all sections and lecture URLs to `data/course_manifest.json`.
```bash
npm run scrape
```

#### Step 2: Play & Generate Transcripts
Iterates through the manifest, plays videos to trigger VTT requests, and generates text files in `data/transcripts/`.

**Play a batch of videos:**
```bash
npm run play -- --batch-size 5
```

**Play a specific section (Session):**
```bash
npm run play -- --session "INTRODUCTION & SCENARIO"
```

**Debug Mode (Visual Browser):**
```bash
npm run dev -- --batch-size 1
```

## 📂 Project Structure
- `src/core/`: Infrastructure (Config, Browser, Logger).
- `src/platform/`: Platform implementations (Teachable).
- `src/automator/`: Coordination and Playback control.
- `src/interceptor/`: Network traffic capture.
- `src/transcript/`: VTT parsing and text processing.
- `data/`: Storage for manifests, raw segments, and final transcripts.

## 🛠️ Tech Stack
- **TypeScript**: Type-safe development.
- **Puppeteer**: Browser automation.
- **Biome**: Ultra-fast linting and formatting.
- **ts-node**: Seamless execution of TypeScript files.
