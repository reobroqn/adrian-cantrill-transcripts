# Adrian Cantrill Transcript Scraper

A lightweight Google Chrome Extension (Manifest V3) that automates the extraction and processing of lesson transcripts from Adrian Cantrill's course platform (`learn.cantrill.io`). 

It bypasses Cloudflare protections and CAPTCHAs by running directly in your browser, intercepts the Hotmart subtitle streams via network inspection, and converts `.webvtt` files into prose transcripts.

---

## ✨ Features

- **In-Browser Execution**: Bypasses bot detection seamlessly.
- **Curriculum Scanning**: Scrape the course dashboard to automatically map out all sections and lessons.
- **Download Current**: Snipe the prose transcript for the active lesson instantly.
- **Download All (Bulk Scrape)**: Automate downloading of all transcripts across the entire course. It spins up 3 background tabs concurrently to process them at speed without interrupting your active browsing.
- **Direct CDN Fetching**: Fetches subtitles directly from the Hotmart CDN, merging the segment assets in milliseconds.

---

## 🛠️ Installation & Setup

1. **Clone the Repository**:
   ```bash
   git clone https://github.com/your-repo/adrian-transcript.git
   cd adrian-transcript
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Build the Extension**:
   ```bash
   npm run build
   ```
   This generates the production bundle in the `dist-extension/` directory.

4. **Load the Extension in Chrome**:
   - Open Google Chrome and go to `chrome://extensions/`.
   - Enable **Developer mode** (toggle in the top-right corner).
   - Click **Load unpacked** (top-left button).
   - Select the `dist-extension/` folder in this repository.

---

## 🚀 How to Use

1. Navigate to your course dashboard on [learn.cantrill.io](https://learn.cantrill.io) (e.g., your AWS Certified Solutions Architect course).
2. You will see a premium glassmorphic floating dashboard labeled **🍊 Adrian Scraper** in the bottom-right corner.
3. Click **🔍 Scan Course** to index all sections and lessons. (Required before using "Download All").
4. Click **💾 Download Current** to process and save the transcript of the video you are currently watching.
5. Click **📥 Download All** to run the multi-tab background scraper. Transcripts will save automatically into your browser's default `Downloads` directory under a `transcripts/` folder.

---

## 📂 Development

- **Run Dev Server** (auto-reloads changes during development):
  ```bash
  npm run dev
  ```
- **Lint Code**:
  ```bash
  npm run lint
  ```
- **Format Code**:
  ```bash
  npm run fix
  ```

---

## 📜 License

MIT License. For educational purposes only.
