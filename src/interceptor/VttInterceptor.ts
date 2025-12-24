import * as fs from "node:fs";
import * as path from "node:path";
import type { HTTPResponse } from "puppeteer";
import { extractVideoIdAndFilename } from "../transcript/helpers";

/**
 * VTT Interceptor - Captures .webvtt responses from video player
 * TypeScript port of mitm_addon.py
 */
export class VttInterceptor {
    private dataDir: string;
    private vttDir: string;

    constructor(projectRoot: string) {
        this.dataDir = path.join(projectRoot, "data");
        this.vttDir = path.join(this.dataDir, "vtt_segments");

        // Ensure directory exists
        fs.mkdirSync(this.vttDir, { recursive: true });
    }

    /**
     * Handle a Puppeteer response - intercept and save .webvtt files
     */
    async handleResponse(response: HTTPResponse): Promise<void> {
        const url = response.url();

        // Only process .webvtt files with 200 status
        if (!url.includes(".webvtt") || response.status() !== 200) {
            return;
        }

        try {
            const { videoId, filename } = extractVideoIdAndFilename(url);

            if (!videoId || !filename) {
                console.error(
                    `Could not extract video_id or filename from URL: ${url}. Skipping.`,
                );
                return;
            }

            // Create a directory for the video_id if it doesn't exist
            const videoDir = path.join(this.vttDir, videoId);
            fs.mkdirSync(videoDir, { recursive: true });

            // Output filename
            const outputFilename = path.join(videoDir, `${filename}.txt`);

            // Skip if the file already exists
            if (fs.existsSync(outputFilename)) {
                console.warn(
                    `File ${outputFilename} already exists. Skipping.`,
                );
                return;
            }

            // Get the VTT content
            const vttContent = await response.text();

            // Save the raw content to a file
            fs.writeFileSync(outputFilename, vttContent, "utf-8");

            console.log(
                `Saved raw VTT segment for video_id: ${videoId} to ${outputFilename}`,
            );
        } catch (error) {
            console.error(`Error saving VTT from ${url}:`, error);
        }
    }
}
