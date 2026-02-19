# Technology Stack

This project is built using a modern, lightweight TypeScript stack focusing on automation and reliability.

## Core Language & Runtime
- **TypeScript**: Used for all logic to provide strict typing, making the complex data structures involved in course manifests and VTT segments easier to manage.
- **Node.js**: The runtime environment, utilizing the `--env-file` flag for native environment variable management.

## Automation & Interception
- **Puppeteer**: The primary driver for browser automation. It manages sessions, navigates the Teachable platform, and interacts with the Hotmart video player.
- **Puppeteer-Extra & Stealth Plugin**: Essential for bypassing common bot detection mechanisms on login and player pages, ensuring the automation remains undetected.

## Tools & Utilities
- **ts-node**: Allows for direct execution of TypeScript files without a separate build step, which is ideal for this type of CLI-driven automation.
- **glob**: Used for efficient filesystem pattern matching, specifically for gathering fragmented VTT segments from the disk.
- **Biome**: A fast tool for linting and formatting the codebase, maintaining a consistent and clean project structure.

## Storage
- **Local Filesystem (JSON/Text)**: No external database is required. State is managed through simple JSON manifests (`data/course_manifest.json`) and raw text segments.
