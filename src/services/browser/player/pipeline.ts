/**
 * pipeline.ts — Single-lecture processing logic.
 */
import { basename } from "node:path";
import type { HTTPResponse, Page } from "puppeteer";
import type { ProcessOptions, QueueItem } from "../../../types";
import { Logger } from "../../../utils/logger";
import {
    ensurePlaying,
    findVideoFrame,
    waitForFinished,
} from "./actions/player";
import { selectEnglishSubtitles } from "./actions/subtitle";
import {
    extractVideoIdAndFilename,
    getTranscriptPath,
    handleVttResponse,
    processTranscripts,
} from "./vtt";

/**
 * Shared task to ensure we only click the "Subtitle" button once per session.
 * Since we share a browser context, the preference persists across all pages.
 */
let subtitleSelectionTask: Promise<void> | null = null;

/** Mutable counter shared between the response listener and seek logger. */
interface SegmentCounter {
    count: number;
}

/**
 * Processes one lecture end-to-end on the given page:
 *   1. Navigates to the lecture URL and starts playback.
 *   2. Intercepts VTT network responses.
 *   3. Seeks through the video (if enabled) to force VTT segment emission.
 *   4. Finalizes the transcript by processing all captured VTT files.
 */
export async function processLecture(
    page: Page,
    item: QueueItem,
    { seek, workerId, direct }: ProcessOptions,
): Promise<boolean> {
    let videoId: string | null = null;
    let masterM3u8Url: string | null = null;
    const counter: SegmentCounter = { count: 0 };

    const onResponse = async (response: HTTPResponse) => {
        const url = response.url();
        if (direct) {
            if (
                url.includes("hotmart.com") &&
                url.includes(".m3u8") &&
                url.includes("master")
            ) {
                masterM3u8Url = url;
            }
            return;
        }

        const { videoId: extractedId } = extractVideoIdAndFilename(url);
        if (extractedId) videoId = extractedId;

        const handled = await handleVttResponse({
            url,
            status: response.status(),
            getContent: () => response.text(),
        });

        if (handled) counter.count++;
    };

    page.on("response", onResponse);

    try {
        await page.goto(item.lecture.url, {
            waitUntil: "networkidle2",
            timeout: 60000,
        });

        const playing = await ensurePlaying(page);
        if (!playing) {
            Logger.warn(
                `[Worker ${workerId}] No video found — skipping: ${item.lecture.title}`,
            );
            return false;
        }

        if (direct) {
            let attempts = 0;
            while (!masterM3u8Url && attempts < 15) {
                await new Promise((r) => setTimeout(r, 1000));
                attempts++;
            }
            if (!masterM3u8Url) {
                Logger.warn(
                    `[Worker ${workerId}] Master HLS playlist not captured after ${attempts}s — skipping direct extraction: ${item.lecture.title}`,
                );
                return false;
            }
            return await extractDirectTranscript(masterM3u8Url, item, workerId);
        }

        // Poll until the HLS stream has emitted a segment URL containing the video ID
        let attempts = 0;
        while (!videoId && attempts < 15) {
            await new Promise((r) => setTimeout(r, 1000));
            attempts++;
        }
        if (!videoId) {
            Logger.warn(
                `[Worker ${workerId}] Video ID not captured after ${attempts}s — skipping: ${item.lecture.title}`,
            );
            return false;
        }

        // Run subtitle selection exactly once per session
        if (!subtitleSelectionTask) {
            Logger.info(
                `[Worker ${workerId}] [${videoId}] Initializing global subtitle preference...`,
            );
            subtitleSelectionTask = selectEnglishSubtitles(
                page,
                videoId,
                workerId,
            ).catch((err) => {
                // If it fails, reset so another worker can try
                subtitleSelectionTask = null;
                throw err;
            });
        }
        await subtitleSelectionTask;

        Logger.info(
            `[Worker ${workerId}] [${videoId}] Processing: ${item.lecture.title}`,
        );

        if (seek) {
            await seekThroughVideo(page, videoId, workerId, counter);
        } else {
            await waitForFinished(page);
        }

        return await saveTranscript(videoId, item, workerId, counter.count);
    } catch (err) {
        Logger.error(
            `[Worker ${workerId}] Error on "${item.lecture.title}": ${err}`,
        );
        return false;
    } finally {
        page.off("response", onResponse);
    }
}

/**
 * Directly downloads VTT segments from CDN bypassing browser playback.
 */
async function extractDirectTranscript(
    masterM3u8Url: string,
    item: QueueItem,
    workerId: number,
): Promise<boolean> {
    const { videoId } = extractVideoIdAndFilename(masterM3u8Url);
    const activeVideoId = videoId || `vid_${Date.now()}`;

    Logger.info(
        `[Worker ${workerId}] [${activeVideoId}] Direct CDN Extraction: ${item.lecture.title}`,
    );

    const headers = {
        "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Referer: "https://player.hotmart.com/",
        Origin: "https://player.hotmart.com",
    };

    try {
        const masterRes = await fetch(masterM3u8Url, { headers });
        if (!masterRes.ok) {
            Logger.error(
                `[Worker ${workerId}] Failed to fetch master playlist: ${masterRes.status} ${masterRes.statusText}`,
            );
            return false;
        }
        const masterContent = await masterRes.text();

        const lines = masterContent.split("\n");
        const enLine = lines.find(
            (l) =>
                l.includes("EXT-X-MEDIA:TYPE=SUBTITLES") &&
                l.includes('LANGUAGE="en"'),
        );
        if (!enLine) {
            Logger.warn(
                `[Worker ${workerId}] [${activeVideoId}] No English subtitle track found in master playlist.`,
            );
            return false;
        }

        const uriMatch = enLine.match(/URI="([^"]+)"/);
        if (!uriMatch || !uriMatch[1]) {
            Logger.error(
                `[Worker ${workerId}] [${activeVideoId}] Could not extract URI from English subtitle line.`,
            );
            return false;
        }

        const baseUrl = masterM3u8Url.substring(
            0,
            masterM3u8Url.lastIndexOf("/") + 1,
        );
        const subtitlePlaylistUrl = baseUrl + uriMatch[1];

        const subPlaylistRes = await fetch(subtitlePlaylistUrl, { headers });
        if (!subPlaylistRes.ok) {
            Logger.error(
                `[Worker ${workerId}] Failed to fetch subtitle playlist: ${subPlaylistRes.status} ${subPlaylistRes.statusText}`,
            );
            return false;
        }
        const subPlaylistContent = await subPlaylistRes.text();

        const subLines = subPlaylistContent.split("\n");
        const vttFiles = subLines.filter(
            (l) => l.trim().length > 0 && !l.trim().startsWith("#"),
        );

        if (vttFiles.length === 0) {
            Logger.warn(
                `[Worker ${workerId}] [${activeVideoId}] No segment files found in subtitle playlist.`,
            );
            return false;
        }

        Logger.info(
            `[Worker ${workerId}] [${activeVideoId}] Downloading ${vttFiles.length} VTT segments directly...`,
        );

        let savedCount = 0;
        const batchSize = 5;
        for (let i = 0; i < vttFiles.length; i += batchSize) {
            const batch = vttFiles.slice(i, i + batchSize);
            await Promise.all(
                batch.map(async (vttUri) => {
                    const vttUrl = baseUrl + vttUri.trim();
                    try {
                        const vttRes = await fetch(vttUrl, { headers });
                        if (vttRes.ok) {
                            const text = await vttRes.text();
                            const handled = await handleVttResponse({
                                url: vttUrl,
                                status: 200,
                                getContent: async () => text,
                            });
                            if (handled) savedCount++;
                        }
                    } catch (err) {
                        Logger.error(
                            `[Worker ${workerId}] Failed to fetch VTT segment ${vttUrl}: ${err}`,
                        );
                    }
                }),
            );
        }

        return await saveTranscript(activeVideoId, item, workerId, savedCount);
    } catch (err) {
        Logger.error(
            `[Worker ${workerId}] [${activeVideoId}] Direct extraction failed: ${err}`,
        );
        return false;
    }
}

/**
 * Rapidly seeks through the video to trigger segment loading.
 * Logs progress every 10 segments.
 */
async function seekThroughVideo(
    page: Page,
    videoId: string,
    workerId: number,
    counter: SegmentCounter,
): Promise<void> {
    const frame = await findVideoFrame(page);
    if (!frame) {
        Logger.warn(
            `[Worker ${workerId}] [${videoId}] Player frame not found for seeking.`,
        );
        return;
    }

    const SEEK_STEP = 10;
    let currentTime = 0;
    let lastLoggedCount = 0;

    while (true) {
        const status = await frame.evaluate((time) => {
            const v = document.querySelector("video") as HTMLVideoElement;
            if (!v) return { ended: true };

            // Wait for duration to be available
            if (!v.duration || Number.isNaN(v.duration)) {
                return { ended: false, duration: 0 };
            }

            v.currentTime = time;
            return {
                ended: v.ended || time >= v.duration,
                duration: v.duration,
            };
        }, currentTime);

        if (status.ended) {
            // Give the browser a moment to fetch the final segments
            await new Promise((r) => setTimeout(r, 2000));
            break;
        }

        if (counter.count >= lastLoggedCount + 10) {
            lastLoggedCount = counter.count;
            Logger.info(
                `[Worker ${workerId}] [${videoId}] Captured ${counter.count} segments...`,
            );
        }

        await new Promise((r) => setTimeout(r, 1000));
        currentTime += SEEK_STEP;
    }
}

/**
 * Finalizes the transcript for a lecture by calling
 * `vttLib.processTranscripts` to convert captured VTT segments into readable prose.
 */
async function saveTranscript(
    videoId: string,
    item: QueueItem,
    workerId: number,
    count: number,
): Promise<boolean> {
    if (count === 0) {
        Logger.warn(
            `[Worker ${workerId}] [${videoId}] No VTT segments captured — skipping transcript generation: ${item.lecture.title}`,
        );
        return false;
    }

    const outputPath = getTranscriptPath(item.section, item.lecture);

    const ok = await processTranscripts(videoId, outputPath);
    if (ok) {
        Logger.info(
            `[Worker ${workerId}] [${videoId}] Saved transcript (${count} segments): ${basename(outputPath)}`,
        );
    }
    return ok;
}
