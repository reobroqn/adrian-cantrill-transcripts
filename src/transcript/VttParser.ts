import * as fs from "node:fs";
import * as path from "node:path";
import { glob } from "glob";

/**
 * Represents a single segment of text from a VTT file
 */
export interface VttSegment {
    timeRange: string; // e.g., "00:00:12.000 --> 00:00:12.320"
    content: string;
    contentId?: string;
}

/**
 * VTT Parser - Processes VTT segment files and creates complete transcripts
 * TypeScript port of make_transcripts.py
 */
export class VttParser {
    private segmentsDir: string;
    private outputDir: string;
    private processedContent: Set<string>;

    constructor(projectRoot: string, segmentsDir?: string, outputDir?: string) {
        const dataDir = path.join(projectRoot, "data");
        this.segmentsDir = segmentsDir || path.join(dataDir, "vtt_segments");
        this.outputDir = outputDir || path.join(dataDir, "transcripts");

        // Ensure output directory exists
        fs.mkdirSync(this.outputDir, { recursive: true });

        this.processedContent = new Set();
    }

    /**
     * Get list of all video IDs in the segments directory
     */
    getVideoIds(): string[] {
        if (!fs.existsSync(this.segmentsDir)) {
            console.error(
                `Segments directory ${this.segmentsDir} does not exist.`,
            );
            return [];
        }

        return fs.readdirSync(this.segmentsDir).filter((item) => {
            return fs.statSync(path.join(this.segmentsDir, item)).isDirectory();
        });
    }

    /**
     * Parse a VTT file and extract segments
     */
    parseVttFile(filePath: string): VttSegment[] {
        const segments: VttSegment[] = [];

        try {
            const content = fs.readFileSync(filePath, "utf-8");
            const lines = content.trim().split("\n");

            // Check for WEBVTT header, but don't fail if missing
            if (lines.length === 0 || !lines[0].trim().startsWith("WEBVTT")) {
                console.warn(
                    `File ${filePath} does not start with WEBVTT header or is empty.`,
                );
            }

            let currentBlockLines: string[] = [];

            for (const rawLine of lines) {
                const line = rawLine.trim();

                // Skip headers and notes
                if (
                    line.startsWith("WEBVTT") ||
                    line.startsWith("X-TIMESTAMP-MAP") ||
                    line.startsWith("NOTE") ||
                    line.startsWith("Kind:") ||
                    line.startsWith("Language:")
                ) {
                    continue;
                }

                // Empty line signifies the end of a cue block
                if (!line) {
                    if (currentBlockLines.length > 0) {
                        const segment = this.parseVttBlock(currentBlockLines);
                        if (segment) {
                            segments.push(segment);
                        }
                        currentBlockLines = [];
                    }
                    continue;
                }

                currentBlockLines.push(line);
            }

            // Process any remaining block
            if (currentBlockLines.length > 0) {
                const segment = this.parseVttBlock(currentBlockLines);
                if (segment) {
                    segments.push(segment);
                }
            }
        } catch (error) {
            console.error(`Error reading file ${filePath}:`, error);
        }

        return segments;
    }

    /**
     * Parse a single VTT block into a VTTSegment
     */
    private parseVttBlock(lines: string[]): VttSegment | null {
        if (lines.length === 0) {
            return null;
        }

        let contentId: string | undefined;
        let timeRange: string | null = null;
        let timeRangeIndex = -1;

        // Find the time range line (contains "-->")
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes("-->")) {
                timeRange = lines[i];
                timeRangeIndex = i;
                break;
            }
        }

        if (!timeRange) {
            return null;
        }

        // Check for content_id (if there's a line before time_range and it's numeric)
        if (timeRangeIndex > 0) {
            const potentialId = lines[0];
            if (/^\d+$/.test(potentialId)) {
                contentId = potentialId;
            }
        }

        // Everything after the time range is content
        const contentLines = lines.slice(timeRangeIndex + 1);
        const fullContent = contentLines.join(" ").trim();

        return {
            timeRange,
            content: fullContent,
            contentId,
        };
    }

    /**
     * Get start time in milliseconds from a segment's time range
     */
    private getStartTimeMs(segment: VttSegment): number {
        const match = segment.timeRange
            .split(" --> ")[0]
            .match(/(\d{2}):(\d{2}):(\d{2})\.(\d{3})/);
        if (match) {
            const [, h, m, s, ms] = match;
            return (
                (parseInt(h, 10) * 3600 +
                    parseInt(m, 10) * 60 +
                    parseInt(s, 10)) *
                    1000 +
                parseInt(ms, 10)
            );
        }
        console.warn(
            `Could not parse start time from time_range: ${segment.timeRange}`,
        );
        return 0;
    }

    /**
     * Process all segments for a video ID and create a complete transcript
     */
    async processVideo(videoId: string, outputPath?: string): Promise<boolean> {
        const videoDir = path.join(this.segmentsDir, videoId);

        if (!fs.existsSync(videoDir)) {
            console.error(
                `No segments directory found for video ID: ${videoId}`,
            );
            return false;
        }

        // Get all segment files for this video ID
        const segmentFiles = await glob(path.join(videoDir, "*.txt"));

        if (segmentFiles.length === 0) {
            console.warn(`No segment files found for video ID: ${videoId}`);
            return false;
        }

        console.log(
            `Found ${segmentFiles.length} segment files for video ID: ${videoId}`,
        );

        // Parse all segments
        const allSegments: VttSegment[] = [];
        for (const filePath of segmentFiles) {
            const segments = this.parseVttFile(filePath);
            allSegments.push(...segments);
        }

        if (allSegments.length === 0) {
            console.warn(`No valid segments parsed for video ID: ${videoId}`);
            return false;
        }

        // Sort segments by start time
        allSegments.sort(
            (a, b) => this.getStartTimeMs(a) - this.getStartTimeMs(b),
        );

        // Process segments to remove duplicates and concatenate incomplete sentences
        const processedText = this.processSegments(allSegments);

        // Determine output file path
        let outputFile: string;
        if (outputPath) {
            outputFile = outputPath;
            // Ensure parent directory exists
            fs.mkdirSync(path.dirname(outputFile), { recursive: true });
        } else {
            outputFile = path.join(this.outputDir, `${videoId}.txt`);
        }

        // Save the transcript to a file
        try {
            fs.writeFileSync(outputFile, processedText, "utf-8");
            console.log(`Transcript for ${videoId} saved to ${outputFile}`);
            return true;
        } catch (error) {
            console.error(`Error saving transcript to ${outputFile}:`, error);
            return false;
        }
    }

    /**
     * Process segments to remove duplicates and concatenate incomplete sentences
     */
    private processSegments(segments: VttSegment[]): string {
        // Reset processed content for this video
        this.processedContent = new Set();

        const result: string[] = [];
        let currentSentence = "";

        for (const segment of segments) {
            // Skip if content is empty
            if (!segment.content.trim()) {
                continue;
            }

            // Skip if this exact content has been seen before
            if (this.processedContent.has(segment.content)) {
                continue;
            }

            this.processedContent.add(segment.content);

            const content = segment.content;

            // If current_sentence is not empty, we're in the middle of building a sentence
            if (currentSentence) {
                const lastChar = currentSentence.trimEnd().slice(-1);
                const firstChar = content[0];

                // If this segment starts with uppercase and previous didn't end with punctuation,
                // it might be a new sentence
                if (
                    firstChar === firstChar.toUpperCase() &&
                    ![".", "!", "?", ":", ";"].includes(lastChar)
                ) {
                    // But check if it's a continuation by common words that can start sentences
                    const continuationWords = [
                        "And",
                        "But",
                        "Or",
                        "So",
                        "Then",
                        "However",
                        "Therefore",
                    ];
                    const isContinuation = continuationWords.some((word) =>
                        content.startsWith(`${word} `),
                    );

                    if (isContinuation) {
                        currentSentence += ` ${content}`;
                    } else {
                        // It's a new sentence, add the current one to results
                        result.push(currentSentence);
                        currentSentence = content;
                    }
                } else {
                    // It's a continuation of the current sentence
                    currentSentence += ` ${content}`;
                }
            } else {
                // Starting a new sentence
                currentSentence = content;
            }

            // If the current sentence ends with sentence-ending punctuation, add it to results
            const lastChar = currentSentence.trimEnd().slice(-1);
            if ([".", "!", "?"].includes(lastChar)) {
                result.push(currentSentence);
                currentSentence = "";
            }
        }

        // Add any remaining sentence
        if (currentSentence) {
            result.push(currentSentence);
        }

        return result.join("\n\n");
    }
}
