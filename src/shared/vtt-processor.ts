import type { VttSegment } from "./types";

const PATTERNS = {
    TIME_RANGE_SEPARATOR: " --> ",
    TIMESTAMP: /(\d{2}):(\d{2}):(\d{2})\.(\d{3})/,
    VTT_HEADER_BLOCKS: /^(WEBVTT|X-TIMESTAMP-MAP|NOTE|Kind:|Language:)/,
};

function parseVttBlock(lines: string[]): VttSegment | null {
    const timeRangeIndex = lines.findIndex((l) =>
        l.includes(PATTERNS.TIME_RANGE_SEPARATOR),
    );
    if (timeRangeIndex === -1) return null;

    const timeRange = lines[timeRangeIndex];
    const content = lines
        .slice(timeRangeIndex + 1)
        .join(" ")
        .trim();

    return { timeRange, content };
}

export function parseVttText(content: string): VttSegment[] {
    const segments: VttSegment[] = [];
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
    return segments;
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

export function processSegmentsToProse(segments: VttSegment[]): string {
    segments.sort((a, b) => getStartTimeMs(a) - getStartTimeMs(b));

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
