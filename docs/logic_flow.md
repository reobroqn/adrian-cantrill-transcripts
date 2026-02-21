# Logic Flow

This document explains the high-level logic behind how the transcripts are extracted and processed.

## 1. Enrollment & Discovery
The process starts by authenticating with Teachable. The scraper navigates directly to the specific course ID. Because modern platforms often use placeholders, the scraper is designed to handle both the "Enrolled" view and the "Sales Page" view (which Puppeteer is sometimes redirected to) to ensure lecture titles and IDs are accurately captured.

## 2. Session Bootstrapping
When the `play` script runs, it first opens a single setup page, logs in once, and then extracts all session cookies. The setup page is immediately closed. These cookies are passed to every worker so they all share the same authenticated session without sharing a browser context (which would cause tab-focus conflicts).

## 3. Parallel Worker Pool
`play.ts` spawns `CONCURRENCY` workers (default: 4 configured in `.env`). Each worker:
1. Creates its own isolated **`BrowserContext`** pre-seeded with the login cookies.
2. Opens a single **`Page`** within that context.
3. Pulls lectures from a shared queue (`sharedQueue.shift()`) until the queue is empty.
4. On completion (or error), closes the entire context, which also cleanly closes its page.

Because each worker has its own context, tabs never fight over the foreground focus slot (`bringToFront`), and Chrome's background throttling flags keep media playing without needing the tab to be visible.

## 4. Playback Orchestration
For each lecture a worker picks up, it follows this sequence:
1. **Navigate**: Go to the lecture URL.
2. **Listen**: Attach a network response listener to capture any URL matching `.webvtt`.
3. **Play**: Locate the video iframe and force it to play (muted) to trigger the HLS stream.
4. **Configure Subtitles**: Open the player's settings menu and force-select "English" to ensure the correct VTT stream is triggered.
5. **Seek** _(if `SEEK=true` in `.env`)_: Jump through the video in 60-second increments to collect all VTT segments without waiting for real-time playback.
6. **Wait**: If not seeking, monitor the video state until it is finished or the timeout is reached.

## 5. The Interception Mechanism
As the video plays (or is seeked), the browser requests small "segments" of the transcript (VTT files). The `vtt` service intercepts every 200-status response for these files. It extracts the `videoId` from the URL to create a unique folder and saves each segment as a separate text file on disk.

## 6. Transcript Generation (The Joining Logic)
Once a video is finished, the system immediately processes the raw segments in-place:
1. **Gather**: Scan the video ID folder for all `.txt` segment files.
2. **Sort**: Parse the timestamps inside each VTT segment and sort them chronologically.
3. **Clean**: Remove duplicate text that often appears in overlapping VTT segments.
4. **Prose Conversion**: Join the segments into paragraphs. The logic looks for sentence-ending punctuation (`.`, `!`, `?`) and capital letters to decide where to break paragraphs, creating a human-readable transcript.

## 7. Persistence
Transcripts are saved in a nested directory structure: `data/transcripts/<Section Name>/<Lecture Name>.txt`. This makes the output ready for ingestion into other tools or for offline reading.
