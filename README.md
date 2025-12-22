# Adrian Cantrill Transcript Automation

This project automates the generation of transcripts for Adrian Cantrill's AWS courses by scraping lecture metadata, playing videos to extract VTT links, and converting them to text.

## Project Structure

The project is split into two main components:

-   **`puppeteer/`**: Node.js/TypeScript automation scripts.
    -   Handles login to Teachable.
    -   Scrapes course structure (`sections` -> `lectures`).
    -   Plays videos in a headless browser to trigger network requests.
    -   Intercepts VTT/HLS stream URLs.
-   **`fastapi/`**: Python scripts for transcript processing (and optional proxy/API).
    -   `mitm_addon.py`: Intercepts VTT segments (used with `mitmproxy`).
    -   `make_transcripts.py`: Converts captured VTT data into clean text transcripts.

## Setup & Usage

### 1. Prerequisites
-   Node.js (v18+)
-   Python (v3.10+)
-   `mitmproxy` installed and running.

### 2. Configuration
Create a `.env` file in `puppeteer/` with:
```env
EMAIL=your_email@example.com
PASSWORD=your_password
COURSE_ID=1820301
```

### 3. Running

#### Step 0: Start Proxy
Start `mitmweb` to capture traffic:
```bash
mitmweb -s fastapi/src/mitm_addon.py
```

#### Step 1: Scrape Course Structure
Extracts all sections and lecture URLs to `puppeteer/data/course_manifest.json`.
```bash
cd puppeteer
npm run scrape
```

#### Step 2: Play & Generate Transcripts
Iterates through the manifest, plays videos, extracts IDs, and calls the Python script to generate transcripts in `puppeteer/transcripts/`.

**Play a batch of videos:**
```bash
cd puppeteer
npm run play -- --batch-size 5
```

**Play a specific section (Session):**
```bash
cd puppeteer
npm run play -- --session "INTRODUCTION & SCENARIO"
```

## Output
Transcripts are saved in:
`puppeteer/transcripts/<Section Name>/<Lecture Name>.txt`
