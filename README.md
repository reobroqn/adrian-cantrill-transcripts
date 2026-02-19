# Adrian Cantrill Transcript Automation

A streamlined automation tool designed to extract high-quality text transcripts from Adrian Cantrill's AWS courses. It handles everything from scraping course structures to automating video playback and processing subtitle streams into clean prose.

## 🚀 Quickstart

1.  **Configure**: Create a `.env` file based on `.env.example` with your credentials.
2.  **Install**: `npm install`
3.  **Scrape**: `npm run scrape` (Generates the course structure)
4.  **Play**: `npm run play -- --batch-size 5` (Plays videos to capture transcripts)
5.  **Convert**: `npm run convert` (Batch processes captured segments into text)

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
```

## 📖 Entry Points

| Command | Description |
| :--- | :--- |
| `npm run scrape` | Logs in and saves the course curriculum to `data/course_manifest.json`. |
| `npm run play` | Orchestrates the browser to play videos and capture VTT subtitle segments. |
| `npm run convert` | A "browserless" utility to process already captured VTT segments into final text files. |
| `npm run dev` | Runs the `play` script in non-headless mode for debugging. |

## ⚙️ Advanced Play Options
- `--batch-size <n>`: Stop after processing `n` lectures.
- `--session "<name>"`: Process only lectures within a specific section.
- `--debug`: Open the browser window to see the automation in action.

## 📄 Documentation
For deeper details on how this project works, check the `docs/` folder:
- [Technology Stack](./docs/technology_stack.md)
- [Component Overview](./docs/component_overview.md)
- [Logic Flow](./docs/logic_flow.md)
