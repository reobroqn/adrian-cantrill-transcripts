# Adrian Cantrill Transcript Automation

A streamlined automation tool designed to extract high-quality text transcripts from Adrian Cantrill's AWS courses. It handles everything from scraping course structures to automating video playback and processing subtitle streams into clean prose.

## 🚀 Quickstart

1. **Configure**: Create a `.env` file based on `.env.example` with your credentials.
2. **Install**: `npm install`
3. **Scrape**: `npm run scrape` — generates the course manifest
4. **Play**: `npm run play` — plays videos and captures transcripts

## 🛠️ Setup

### Prerequisites
- **Node.js**: v20+
- **Teachable Account**: Enrolled in an Adrian Cantrill course.

### Environment Variables
Create a `.env` file in the root:
```env
EMAIL=your_email@example.com
PASSWORD=your_password
COURSE_ID=1820301
BATCH_SIZE=10
CONCURRENCY=4
SEEK=false
```

## 📖 Commands

| Command | Description |
| :--- | :--- |
| `npm run scrape` | Logs in and saves the course curriculum to `data/course_manifest.json`. |
| `npm run play` | Orchestrates the browser to play videos and capture VTT subtitle segments into transcripts. |
| `npm run dev` | Runs the `play` script in non-headless (visible browser) mode for debugging. |

---

## ⚙️ `npm run scrape` — Options

| Flag | Description |
| :--- | :--- |
| `--debug` | Opens the browser window so you can watch the scraper navigate the course. |

**Examples:**
```bash
npm run scrape
npm run scrape -- --debug
```

---

## ⚙️ `npm run play` — Options

| Flag | Default | Description |
| :--- | :---: | :--- |
| `--session <name\|index>` | _(all)_ | Process only lectures within a matching section. Can be a string search (e.g., `"IAM"`) or a 1-based numerical index (e.g., `2` for the second section). |
| `--debug` | `false` | Opens the browser window so you can watch the automation in action. |

> **Note:** Configure worker concurrency, batch size limits, and seeking behavior using the `CONCURRENCY`, `BATCH_SIZE`, and `SEEK` variables in your `.env` file.

**Examples:**
```bash
# Process all lectures using the settings from your .env
npm run play

# Process only lectures in the "IAM" section (fuzzy string match)
npm run play -- --session "IAM"

# Process only the 2nd section from the course curriculum (1-based index)
npm run play -- --session 2

# Process a single section in debug mode to see what's happening
npm run play -- --session "S3" --debug
```

---

## 📁 Output Structure

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

## 📄 Documentation
For deeper details on how this project works, check the `docs/` folder:
- [Technology Stack](./docs/technology_stack.md)
- [Component Overview](./docs/component_overview.md)
- [Logic Flow](./docs/logic_flow.md)
- [Architecture](./docs/architecture.md)
