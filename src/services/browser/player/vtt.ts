import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { glob } from "glob";
import type {
    Lecture,
    VideoIdAndFilename,
    VttResponseData,
    VttSegment,
} from "../../../types";
import { checkFileExists, writeFileSafe } from "../../../utils/fs";
import { Logger } from "../../../utils/logger";
import { TRANSCRIPTS_DIR, VTT_DIR } from "../constants";

const PATTERNS = {
    TIME_RANGE_SEPARATOR: " --> ",
    TIMESTAMP: /(\d{2}):(\d{2}):(\d{2})\.(\d{3})/,
    VTT_HEADER_BLOCKS: /^(WEBVTT|X-TIMESTAMP-MAP|NOTE|Kind:|Language:)/,
    VIDEO_PATH: /\/video\/([^/]+)\/hls\//,
    VTT_EXTENSION: ".webvtt",
    HLS_LANG: /textstream_([a-z]{2,3})=/,
};

// ============================================================================
// VTT Ingestion (Network)
// ============================================================================

/**
 * Returns true when an HTTP response is an English-language WebVTT subtitle
 * segment that should be saved.
 */
function isEnglishVttResponse(url: string, status: number): boolean {
    if (!url.includes(PATTERNS.VTT_EXTENSION) || status !== 200) return false;
    const langMatch = url.match(PATTERNS.HLS_LANG);
    return !langMatch || langMatch[1] === "eng";
}

/**
 * Extracts the Hotmart video ID and segment filename from a VTT CDN URL.
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
 * Normalizes a string for use as a filename by removing illegal characters,
 * collapsing whitespace, and trimming.
 */
export function sanitizeFilename(raw: string): string {
    return raw
        .replace(/[\r\n]+/g, " ")
        .replace(/[<>:"/\\|?*]/g, "_")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Resolves the absolute output path for a lecture transcript.
 */
export function getTranscriptPath(section: string, lecture: Lecture): string {
    const cleanSection = sanitizeFilename(section);
    const rawTitle =
        lecture.title && lecture.title !== "Lecture unknown"
            ? lecture.title
            : `lecture_${lecture.id}`;
    const cleanLecture = sanitizeFilename(rawTitle);
    return join(TRANSCRIPTS_DIR, cleanSection, `${cleanLecture}.txt`);
}

/**
 * Saves a new English WebVTT segment to disk.
 * Returns true if the segment was valid and handled (even if already existing).
 */
export async function handleVttResponse(
    data: VttResponseData,
): Promise<boolean> {
    const { url, status } = data;
    if (!isEnglishVttResponse(url, status)) return false;

    try {
        const { videoId, filename } = extractVideoIdAndFilename(url);
        if (!videoId || !filename) return false;

        const videoDir = join(VTT_DIR, videoId);
        const outputFilename = join(videoDir, `${filename}.txt`);

        if (!(await checkFileExists(outputFilename))) {
            const vttContent = await data.getContent();
            await writeFileSafe(outputFilename, vttContent);
            Logger.debug(`Saved VTT segment: ${videoId} -> ${filename}`);
        }

        return true;
    } catch (error) {
        Logger.error(`Error intercepting VTT: ${error}`);
        return false;
    }
}

// ============================================================================
// VTT Parsing (Disk)
// ============================================================================

/**
 * Reads and parses all cue blocks from a single `.txt` VTT file.
 * Skips header lines (WEBVTT, X-TIMESTAMP-MAP, NOTE, Kind, Language).
 */
async function parseVttFile(filePath: string): Promise<VttSegment[]> {
    const segments: VttSegment[] = [];
    try {
        const content = await readFile(filePath, "utf-8");
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
// Transcript Generation
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

    const CONTINUATION_WORDS = [
        "And",
        "But",
        "Or",
        "So",
        "Then",
        "However",
        "Therefore",
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
                ![".", "!", "?", ":", ";", ","].includes(lastChar);
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
export async function processTranscripts(
    videoId: string,
    outputPath: string,
): Promise<boolean> {
    const videoDir = join(VTT_DIR, videoId);

    if (!(await checkFileExists(videoDir))) {
        Logger.warn(
            `processVideo: No segments directory found for video ${videoId}. Skipping.`,
        );
        return false;
    }
    // glob requires forward slashes on Windows
    const globPattern = join(videoDir, "*.txt").replace(/\\/g, "/");
    const segmentFiles = await glob(globPattern);
    if (segmentFiles.length === 0) return false;

    const segmentPromises = segmentFiles.map((f) => parseVttFile(f));
    const allSegments = (await Promise.all(segmentPromises)).flat();

    if (allSegments.length === 0) return false;

    allSegments.sort((a, b) => getStartTimeMs(a) - getStartTimeMs(b));

    const processedText = processSegments(allSegments);

    try {
        await writeFileSafe(outputPath, processedText);
        return true;
    } catch (error) {
        Logger.error(`Error saving transcript: ${error}`);
        return false;
    }
}
