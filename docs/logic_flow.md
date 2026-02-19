# Logic Flow

This document explains the high-level logic behind how the transcripts are extracted and processed.

## 1. Enrollment & Discovery
The process starts by authenticating with Teachable. The scraper navigates directly to the specific course ID. Because modern platforms often use placeholders, the scraper is designed to handle both the "Enrolled" view and the "Sales Page" view (which Puppeteer is sometimes redirected to) to ensure lecture titles and IDs are accurately captured.

## 2. Playback Orchestration
When the `play` script runs, it follows this sequence for every lecture:
1. **Navigate**: Go to the lecture URL.
2. **Listen**: Attach a network listener to capture any URL containing `.webvtt`.
3. **Play**: Locate the video iframe and force it to play (muted) to trigger the stream.
4. **Configure Subtitles**: Open the player's settings menu and force-select "English" to ensure the correct VTT stream is triggered.
5. **Wait**: Monitor the video state and wait until it is either finished or the timeout is reached.

## 3. The Interception Mechanism
As the video plays, the browser requests small "segments" of the transcript (VTT files). The `vtt` service intercepts every 200-status response for these files. It extracts the `videoId` from the URL to create a unique folder for that video and saves each segment as a separate text file on the disk.

## 4. Transcript Generation (The Joining Logic)
Once a video is finished, or when the `convert` script is manually run, the system processes the raw segments:
1. **Gather**: Scan the video ID folder for all `.txt` segment files.
2. **Sort**: Parse the timestamps inside each VTT segment and sort them chronologically.
3. **Clean**: Remove duplicate text that often appears in overlapping VTT segments.
4. **Prose Conversion**: Join the segments into paragraphs. The logic looks for sentence-ending punctuation (`.`, `!`, `?`) and capital letters to decide where to break paragraphs, creating a human-readable transcript instead of a raw subtitle list.

## 5. Persistence
Transcripts are saved in a nested directory structure: `data/transcripts/<Section Name>/<Lecture Name>.txt`. This makes the output ready for ingestion into other tools or for offline reading.
