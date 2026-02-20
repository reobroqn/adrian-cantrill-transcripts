/**
 * vtt.ts — VTT segment interception, parsing, and transcript generation.
 *
 * Three responsibilities:
 *   1. Network interception  — handleVttResponse / extractVideoIdAndFilename
 *   2. VTT parsing           — parseVttFile / parseVttBlock / getStartTimeMs
 *   3. Transcript generation — processSegments / processVideo
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { glob } from "glob";
import type { HTTPResponse } from "puppeteer";
import { config } from "../core/config";
import { Logger } from "../core/logger";
import type { VideoIdAndFilename, VttSegment } from "../core/types";

const PATTERNS = {
    VIDEO_PATH: /\/video\/([^/]+)\/hls\//,
    VTT_EXTENSION: ".webvtt",
    TIME_RANGE_SEPARATOR: " --> ",
    TIMESTAMP: /(\d{2}):(\d{2}):(\d{2})\.(\d{3})/,
    VTT_HEADER_BLOCKS: /^(WEBVTT|X-TIMESTAMP-MAP|NOTE|Kind:|Language:)/,
    /** Characters illegal in Windows / POSIX filenames */
    FILENAME_SANITIZE: /[<>:"/\\|?*]/g,
};

// ============================================================================
// Filename utilities (exported for use in entrypoints)
// ============================================================================

/**
 * Returns a safe filesystem name from any string:
 * collapses newlines, strips illegal characters, collapses runs of spaces.
 */
export function sanitizeFilename(raw: string): string {
    return raw
        .replace(/[\r\n]+/g, " ")
        .replace(PATTERNS.FILENAME_SANITIZE, "_")
        .replace(/\s+/g, " ")
        .trim();
}

// ============================================================================
// Network interception
// ============================================================================

export function extractVideoIdAndFilename(url: string): VideoIdAndFilename {
    const videoMatch = url.match(PATTERNS.VIDEO_PATH);

    if (!videoMatch) {
        Logger.warn(`Could not extract video_id from URL: ${url}`);
        return { videoId: null, filename: null };
    }

    const videoId = videoMatch[1];
    let filename: string | null = null;

    try {
        const urlObj = new URL(url);
        const pathSegments = urlObj.pathname
            .split("/")
            .filter((s) => s.length > 0);

        if (
            pathSegments.length > 0 &&
            pathSegments[pathSegments.length - 1].endsWith(PATTERNS.VTT_EXTENSION)
        ) {
            const lastSegment = pathSegments[pathSegments.length - 1];
            filename = lastSegment.slice(0, -7); // strip ".webvtt"
        }
    } catch (error) {
        Logger.error(`Error parsing URL: ${error}`);
    }

    return { videoId, filename };
}

export async function handleVttResponse(response: HTTPResponse): Promise<void> {
    const url = response.url();

    if (!url.includes(PATTERNS.VTT_EXTENSION) || response.status() !== 200) {
        return;
    }

    // Only save English subtitle segments.
    // Hotmart HLS streams include: textstream_eng=1000, textstream_ara=1000
    const langMatch = url.match(/textstream_([a-z]{2,3})=/);
    if (langMatch && langMatch[1] !== "eng") {
        return;
    }

    try {
        const { videoId, filename } = extractVideoIdAndFilename(url);
        if (!videoId || !filename) return;

        const videoDir = path.join(config.vttDir, videoId);
        fs.mkdirSync(videoDir, { recursive: true });

        const outputFilename = path.join(videoDir, `${filename}.txt`);
        if (fs.existsSync(outputFilename)) return;

        const vttContent = await response.text();
        fs.writeFileSync(outputFilename, vttContent, "utf-8");

        Logger.debug(`Saved VTT segment: ${videoId} -> ${filename}`);
    } catch (error) {
        Logger.error(`Error intercepting VTT: ${error}`);
    }
}

// ============================================================================
// VTT parsing
// ============================================================================

function parseVttFile(filePath: string): VttSegment[] {
    const segments: VttSegment[] = [];
    try {
        const content = fs.readFileSync(filePath, "utf-8");
        const lines = content.trim().split("\n");

        let currentBlockLines: string[] = [];
        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line) {
                if (currentBlockLines.length > 0) {
                    const segment = parseVttBlock(currentBlockLines);
                    if (segment) segments.push(segment);
                    currentBlockLines = [];
                }
                continue;
            }
            if (line.match(PATTERNS.VTT_HEADER_BLOCKS)) continue;
            currentBlockLines.push(line);
        }

        if (currentBlockLines.length > 0) {
            const segment = parseVttBlock(currentBlockLines);
            if (segment) segments.push(segment);
        }
    } catch (error) {
        Logger.error(`Error parsing VTT file ${filePath}: ${error}`);
    }
    return segments;
}

function parseVttBlock(lines: string[]): VttSegment | null {
    const timeRangeIndex = lines.findIndex((l) =>
        l.includes(PATTERNS.TIME_RANGE_SEPARATOR),
    );
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

function getStartTimeMs(segment: VttSegment): number {
    const match = segment.timeRange
        .split(PATTERNS.TIME_RANGE_SEPARATOR)[0]
        .match(PATTERNS.TIMESTAMP);
    if (!match) return 0;
    const [, h, m, s, ms] = match;
    return (
        (parseInt(h, 10) * 3600 + parseInt(m, 10) * 60 + parseInt(s, 10)) *
        1000 +
        parseInt(ms, 10)
    );
}

// ============================================================================
// Transcript generation
// ============================================================================

function processSegments(segments: VttSegment[]): string {
    const seen = new Set<string>();
    const result: string[] = [];
    let currentSentence = "";

    const CONTINUATION_WORDS = [
        "And", "But", "Or", "So", "Then", "However", "Therefore",
    ];

    for (const segment of segments) {
        const content = segment.content.trim();
        if (!content || seen.has(content)) continue;
        seen.add(content);

        if (currentSentence) {
            const lastChar = currentSentence.trimEnd().slice(-1);
            const firstChar = content[0];
            const isNewSentence =
                firstChar === firstChar.toUpperCase() &&
                ![".", "!", "?", ":", ";"].includes(lastChar);
            const isContinuation = CONTINUATION_WORDS.some((word) =>
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

/**
 * Reads all VTT segment files for a given videoId, sorts them by timestamp,
 * deduplicates content, and writes the joined transcript to outputPath.
 */
export async function processVideo(
    videoId: string,
    outputPath: string,
): Promise<boolean> {
    const videoDir = path.join(config.vttDir, videoId);

    if (!fs.existsSync(videoDir)) {
        Logger.error(`No segments found for video: ${videoId}`);
        return false;
    }

    // glob requires forward slashes on Windows
    const globPattern = path.join(videoDir, "*.txt").replace(/\\/g, "/");
    const segmentFiles = await glob(globPattern);
    if (segmentFiles.length === 0) return false;

    const allSegments: VttSegment[] = [];
    for (const filePath of segmentFiles) {
        allSegments.push(...parseVttFile(filePath));
    }
    if (allSegments.length === 0) return false;

    allSegments.sort((a, b) => getStartTimeMs(a) - getStartTimeMs(b));

    const processedText = processSegments(allSegments);

    try {
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, processedText, "utf-8");
        return true;
    } catch (error) {
        Logger.error(`Error saving transcript: ${error}`);
        return false;
    }
}
