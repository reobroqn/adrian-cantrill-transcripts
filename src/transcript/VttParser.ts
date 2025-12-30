import * as fs from "node:fs";
import * as path from "node:path";
import { glob } from "glob";
import { ConfigService } from "../core/ConfigService";
import { Logger } from "../core/Logger";

export interface VttSegment {
    timeRange: string;
    content: string;
    contentId?: string;
}

export class VttParser {
    private readonly config = ConfigService.getInstance();
    private processedContent: Set<string> = new Set();

    constructor() {
        fs.mkdirSync(this.config.transcriptsDir, { recursive: true });
    }

    async processVideo(videoId: string, outputPath: string): Promise<boolean> {
        const videoDir = path.join(this.config.vttDir, videoId);

        if (!fs.existsSync(videoDir)) {
            Logger.error(`No segments found for video: ${videoId}`);
            return false;
        }

        const segmentFiles = await glob(path.join(videoDir, "*.txt"));
        if (segmentFiles.length === 0) return false;

        const allSegments: VttSegment[] = [];
        for (const filePath of segmentFiles) {
            allSegments.push(...this.parseVttFile(filePath));
        }

        if (allSegments.length === 0) return false;

        allSegments.sort(
            (a, b) => this.getStartTimeMs(a) - this.getStartTimeMs(b),
        );

        const processedText = this.processSegments(allSegments);

        try {
            fs.mkdirSync(path.dirname(outputPath), { recursive: true });
            fs.writeFileSync(outputPath, processedText, "utf-8");
            return true;
        } catch (error) {
            Logger.error(`Error saving transcript: ${error}`);
            return false;
        }
    }

    private parseVttFile(filePath: string): VttSegment[] {
        const segments: VttSegment[] = [];
        try {
            const content = fs.readFileSync(filePath, "utf-8");
            const lines = content.trim().split("\n");

            let currentBlockLines: string[] = [];
            for (const rawLine of lines) {
                const line = rawLine.trim();
                if (!line) {
                    if (currentBlockLines.length > 0) {
                        const segment = this.parseVttBlock(currentBlockLines);
                        if (segment) segments.push(segment);
                        currentBlockLines = [];
                    }
                    continue;
                }
                if (
                    line.match(/^(WEBVTT|X-TIMESTAMP-MAP|NOTE|Kind:|Language:)/)
                )
                    continue;
                currentBlockLines.push(line);
            }

            if (currentBlockLines.length > 0) {
                const segment = this.parseVttBlock(currentBlockLines);
                if (segment) segments.push(segment);
            }
        } catch (error) {
            Logger.error(`Error parsing VTT file ${filePath}: ${error}`);
        }
        return segments;
    }

    private parseVttBlock(lines: string[]): VttSegment | null {
        const timeRangeIndex = lines.findIndex((l) => l.includes("-->"));
        if (timeRangeIndex === -1) return null;

        const timeRange = lines[timeRangeIndex];
        const contentId =
            timeRangeIndex > 0 && /^\d+$/.test(lines[0]) ? lines[0] : undefined;
        const content = lines
            .slice(timeRangeIndex + 1)
            .join(" ")
            .trim();

        return { timeRange, content, contentId };
    }

    private getStartTimeMs(segment: VttSegment): number {
        const match = segment.timeRange
            .split(" --> ")[0]
            .match(/(\d{2}):(\d{2}):(\d{2})\.(\d{3})/);
        if (!match) return 0;
        const [, h, m, s, ms] = match;
        return (
            (parseInt(h, 10) * 3600 + parseInt(m, 10) * 60 + parseInt(s, 10)) *
                1000 +
            parseInt(ms, 10)
        );
    }

    private processSegments(segments: VttSegment[]): string {
        this.processedContent = new Set();
        const result: string[] = [];
        let currentSentence = "";

        for (const segment of segments) {
            const content = segment.content.trim();
            if (!content || this.processedContent.has(content)) continue;
            this.processedContent.add(content);

            if (currentSentence) {
                const lastChar = currentSentence.trimEnd().slice(-1);
                const firstChar = content[0];
                const isNewSentence =
                    firstChar === firstChar.toUpperCase() &&
                    ![".", "!", "?", ":", ";"].includes(lastChar);
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

                if (isNewSentence && !isContinuation) {
                    result.push(currentSentence);
                    currentSentence = content;
                } else {
                    currentSentence += ` ${content}`;
                }
            } else {
                currentSentence = content;
            }

            if ([".", "!", "?"].includes(currentSentence.trimEnd().slice(-1))) {
                result.push(currentSentence);
                currentSentence = "";
            }
        }

        if (currentSentence) result.push(currentSentence);
        return result.join("\n\n");
    }
}
