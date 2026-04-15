# Adrian Cantrill Transcript Automation

A TypeScript CLI tool to automate the extraction of transcripts from Adrian Cantrill's courses. It uses Puppeteer to scrape course metadata and a parallel worker pool to process video subtitle segments into consolidated text files.

## 🚀 Quickstart

1.  **Clone & Install**:
    ```bash
    git clone https://github.com/your-repo/adrian-transcript.git
    cd adrian-transcript
    npm install
    ```
2.  **Configure**: Copy `.env.example` to `.env` and provide your Teachable credentials and preferences.
3.  **Run**: Use either the global command or the development script.

### Option A: Global Command
Install the global command using `npm run setup`.
You can run the tool from anywhere in the project:
```bash
adrian-transcript scrape
adrian-transcript play
```

### Option B: Development Script
Alternatively, run the source directly using `npm run dev`:
```bash
npm run dev scrape
npm run dev play
```

## 🛠️ Configuration

The tool is configured primarily via the `.env` file. Edit it to customize the automation:
| Variable | Description |
| :--- | :--- |
| `EMAIL` / `PASSWORD` | Your Teachable credentials. |
| `COURSE_ID` | The ID from your course URL (e.g., `1820301`). |
| SESSION | Filter by section title or index (e.g., "IAM" or "1"). Takes priority over `ALL`. |
| `ALL` | Set to `true` to process the entire manifest (ignored if `SESSION` is set). |
| `CONCURRENCY` | Number of parallel browser instances (recommended: 4). |
| `SEEK` | Set to `true` to rapidly seek through videos (fast) or `false` for real-time. |
| `DIRECT` | Set to `true` to bypass video playback and download VTTs directly from CDN. |

## 📖 CLI Reference

The CLI is intentionally minimal, with all logic controlled by your environment variables.

### 1. `scrape`
Scans the course dashboard and saves the structure to `data/course_manifest.json`.

| Flag | Description |
| :--- | :--- |
| `-d, --debug` | Enable headful mode and DevTools. |

---

### 2. `play`
Orchestrates the capture of subtitle streams and generates text transcripts.

| Flag | Description |
| :--- | :--- |
| `-d, --debug` | Enable headful mode for debugging. |

**Examples**:
```bash
# Process based on .env settings
adrian-transcript play

# Process with direct CDN extraction (fastest)
adrian-transcript play --direct

# Process with headful browser for debugging
adrian-transcript play --debug
```


## 📁 Output Structure

Captured data is organized logically:
```
data/
├── course_manifest.json          # Course map produced by scrape
└── transcripts/
    ├── 01 - Introduction/
    │   ├── Welcome to the Course.txt
    │   └── Course Overview.txt
    └── 02 - IAM/
        ├── IAM Basics.txt
        └── IAM Policies.txt
```
