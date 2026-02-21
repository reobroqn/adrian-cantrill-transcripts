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
    HLS_LANG: /textstream_([a-z]{2,3})=/,
    TIME_RANGE_SEPARATOR: " --> ",
    TIMESTAMP: /(\d{2}):(\d{2}):(\d{2})\.(\d{3})/,
    VTT_HEADER_BLOCKS: /^(WEBVTT|X-TIMESTAMP-MAP|NOTE|Kind:|Language:)/,
    FILENAME_SANITIZE: /[<>:"/\\|?*]/g,
};

/**
 * Conjunction words that typically continue a thought rather than starting a
 * new sentence, used by `processSegments` to decide paragraph breaks.
 */
const CONTINUATION_WORDS = [
    "And",
    "But",
    "Or",
    "So",
    "Then",
    "However",
    "Therefore",
];

// ============================================================================
// Filename utilities
// ============================================================================

/**
 * Converts any string to a safe filesystem name by collapsing newlines,
 * stripping characters illegal on Windows/POSIX, and trimming whitespace.
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

/**
 * Returns true when an HTTP response is an English-language WebVTT subtitle
 * segment that should be saved. Filters out non-VTT, non-200, and non-English
 * responses early so the heavier processing is only done when needed.
 */
function isEnglishVttResponse(url: string, status: number): boolean {
    if (!url.includes(PATTERNS.VTT_EXTENSION) || status !== 200) return false;
    const langMatch = url.match(PATTERNS.HLS_LANG);
    return !langMatch || langMatch[1] === "eng";
}

/**
 * Extracts the Hotmart video ID and segment filename from a VTT CDN URL.
 * Returns `{ videoId: null, filename: null }` when the URL doesn't match the
 * expected HLS path structure.
 */
export function extractVideoIdAndFilename(url: string): VideoIdAndFilename {
    const videoMatch = url.match(PATTERNS.VIDEO_PATH);
    if (!videoMatch) {
        return { videoId: null, filename: null };
    }

    const videoId = videoMatch[1];
    let filename: string | null = null;

    try {
        const urlObj = new URL(url);
        const segments = urlObj.pathname.split("/").filter((s) => s.length > 0);
        const last = segments[segments.length - 1];
        if (last?.endsWith(PATTERNS.VTT_EXTENSION)) {
            filename = last.slice(0, -7); // strip ".webvtt"
        }
    } catch (error) {
        Logger.error(`Failed to parse VTT URL: ${error}`);
    }

    return { videoId, filename };
}

/**
 * Puppeteer `response` event handler. Saves each new English WebVTT segment
 * to disk under `data/vtt_segments/<videoId>/`. Skips duplicates and
 * non-English or non-200 responses silently.
 */
export async function handleVttResponse(response: HTTPResponse): Promise<void> {
    const url = response.url();
    if (!isEnglishVttResponse(url, response.status())) return;

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

/**
 * Reads and parses all cue blocks from a single `.txt` VTT file.
 * Skips header lines (WEBVTT, X-TIMESTAMP-MAP, NOTE, Kind, Language).
 */
function parseVttFile(filePath: string): VttSegment[] {
    const segments: VttSegment[] = [];
    try {
        const content = fs.readFileSync(filePath, "utf-8");
        const lines = content.trim().split("\n");

        let currentBlock: string[] = [];
        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line) {
                if (currentBlock.length > 0) {
                    const segment = parseVttBlock(currentBlock);
                    if (segment) segments.push(segment);
                    currentBlock = [];
                }
                continue;
            }
            if (line.match(PATTERNS.VTT_HEADER_BLOCKS)) continue;
            currentBlock.push(line);
        }

        if (currentBlock.length > 0) {
            const segment = parseVttBlock(currentBlock);
            if (segment) segments.push(segment);
        }
    } catch (error) {
        Logger.error(`Error parsing VTT file ${filePath}: ${error}`);
    }
    return segments;
}

/**
 * Parses a single VTT cue block (an array of trimmed, non-empty lines).
 * Expects the block to contain a `HH:MM:SS.mmm --> HH:MM:SS.mmm` line.
 * Returns `null` for malformed blocks with no time range.
 */
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

/** Converts a VTT cue's time range string to an absolute millisecond offset. */
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

/**
 * Collapses a sorted list of VTT cue segments into readable prose paragraphs.
 * Duplicated cue text is skipped. Sentences are joined unless the next chunk
 * starts a new sentence AND is not a continuation conjunction.
 */
function processSegments(segments: VttSegment[]): string {
    const seen = new Set<string>();
    const result: string[] = [];
    let currentSentence = "";

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
 * Reads all saved VTT segment files for a video, sorts them chronologically,
 * deduplicates cue text, and writes the final transcript to `outputPath`.
 *
 * Returns `true` on success, `false` if no segments exist or writing fails.
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

    const allSegments: VttSegment[] = segmentFiles.flatMap((f) =>
        parseVttFile(f),
    );
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
