# Component Overview

The project is organized into three main layers: **Core**, **Services**, and **Entrypoints**.

## 1. Core Layer (`src/core/`)
Foundational utilities that provide the environment for the automation.
- **`browser.ts`**: Manages the Puppeteer browser lifecycle, including stealth configuration and page creation.
- **`config.ts`**: Acts as the central source of truth for environment variables and directory paths.
- **`logger.ts`**: A standardized logging wrapper providing consistent feedback across the CLI.
- **`types.ts`**: Defines the shared intellectual model of the project (e.g., what a `Lecture`, `Section`, or `Manifest` looks like).

## 2. Service Layer (`src/services/`)
Domain-specific logic categorized by responsibility.
- **`teachable.ts`**: Handles the "outer" layer of the course—logging in, navigating to enrolled courses, and scraping the curriculum manifest.
- **`player.ts`**: Controls the video player inside the iframe. It can play/mute videos and detect when a video has finished.
- **`subtitle.ts`**: Specifically manages the UI interactions with the Hotmart player to ensure English captions are enabled.
- **`vtt.ts`**: The engine for data extraction. It intercepts network requests to find `.webvtt` files, parses them, and joins them into coherent text transcripts.
- **`manifest.ts`**: Manages the persistence of the course manifest and builds the queue of lectures for processing.

## 3. Entrypoints (`src/`)
The high-level scripts that orchestrate the services.
- **`scrape.ts`**: The "Explorer"—scrapes the curriculum to create a map of the course.
- **`play.ts`**: The "Worker"—navigates through the course, plays videos, and captures data.
- **`convert.ts`**: The "Processor"—takes raw captured data from the disk and turns it into clean transcripts without needing a browser.
