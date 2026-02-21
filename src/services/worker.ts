/**
 * worker.ts — Parallel worker pool for lecture processing.
 *
 * Exports:
 *   - `runWorkerPool`  — spins up N isolated BrowserContexts and drains the queue
 *
 * Private pipeline for each lecture:
 *   - `processLecture` — navigate, play, capture VTT, write transcript
 *   - `seekThroughVideo` — jump through the video timeline to force HLS segment requests
 *   - `saveTranscript` — resolve output path and invoke VTT → transcript conversion
 */
import * as path from "node:path";
import type { Browser, CookieParam, HTTPResponse, Page } from "puppeteer";
import { createWorkerContext } from "../core/browser";
import { config } from "../core/config";
import { Logger } from "../core/logger";
import type { QueueItem } from "./manifest";
import * as player from "./player";
import * as subtitle from "./subtitle";
import * as vtt from "./vtt";

// ============================================================================
// Types
// ============================================================================

export interface WorkerPoolOptions {
    concurrency: number;
    seek: boolean;
}

interface ProcessOptions {
    seek: boolean;
    workerId: number;
}

/** Mutable counter shared between the response listener and seek logger. */
interface SegmentCounter {
    count: number;
}

// ============================================================================
// Single-lecture pipeline
// ============================================================================

/**
 * Processes one lecture end-to-end on the given page:
 *   1. Navigates to the lecture URL and starts playback.
 *   2. Waits for the HLS stream to reveal the video ID.
 *   3. Enables English subtitles.
 *   4. Seeks through or waits for the full video to collect VTT segments.
 *   5. Converts captured segments into a transcript file.
 *
 * Returns `true` on success, `false` on any skip or failure.
 */
async function processLecture(
    page: Page,
    item: QueueItem,
    options: ProcessOptions,
): Promise<boolean> {
    const { workerId } = options;
    let videoId: string | null = null;
    const counter: SegmentCounter = { count: 0 };

    const onResponse = async (response: HTTPResponse) => {
        const url = response.url();
        const match = url.match(/\/video\/([^/]+)\/hls\//);
        if (match?.[1]) videoId = match[1];

        await vtt.handleVttResponse(response);
        if (url.includes(".webvtt") && response.status() === 200)
            counter.count++;
    };

    page.on("response", onResponse);

    try {
        await page.goto(item.lecture.url, {
            waitUntil: "networkidle2",
            timeout: 60000,
        });

        const playing = await player.ensurePlaying(page);
        if (!playing) {
            Logger.warn(
                `[Worker ${workerId}] No video found — skipping: ${item.lecture.title}`,
            );
            return false;
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

        await subtitle.selectEnglishSubtitles(page);
        Logger.info(
            `[Worker ${workerId}] [${videoId}] Processing: ${item.lecture.title}`,
        );

        if (options.seek) {
            await seekThroughVideo(page, videoId, workerId, counter);
        } else {
            await player.waitForFinished(page);
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
 * Seeks through a video in 60-second jumps to force the HLS player to
 * request VTT subtitle segments for the entire timeline, faster than
 * real-time playback.
 *
 * Logs progress every 5 jumps so long videos remain visible in the console.
 * Reads `counter.count` live (shared reference) so the logged segment count
 * reflects segments captured up to that moment.
 */
async function seekThroughVideo(
    page: Page,
    videoId: string,
    workerId: number,
    counter: SegmentCounter,
): Promise<void> {
    const frame = await player.findVideoFrame(page);
    if (!frame) return;

    const duration = await frame.evaluate(() => {
        const v = document.querySelector("video");
        return v ? v.duration : 0;
    });
    if (duration <= 0) return;

    const totalJumps = Math.ceil(duration / 60);
    for (let t = 0; t <= duration; t += 60) {
        await frame.evaluate((seekTime: number) => {
            const v = document.querySelector("video");
            if (v) v.currentTime = seekTime;
        }, t);
        await new Promise((r) => setTimeout(r, 4000));

        const jump = Math.round(t / 60) + 1;
        if (jump % 5 === 0 || jump === totalJumps) {
            Logger.info(
                `[Worker ${workerId}] [${videoId}] Seek ${jump}/${totalJumps} — ${counter.count} segments captured`,
            );
        }
    }
}

/**
 * Resolves the output path for a lecture transcript and delegates to
 * `vtt.processVideo` to convert captured VTT segments into readable prose.
 */
async function saveTranscript(
    videoId: string,
    item: QueueItem,
    workerId: number,
    segmentCount: number,
): Promise<boolean> {
    const cleanSection = vtt.sanitizeFilename(item.section);
    const rawTitle =
        item.lecture.title && item.lecture.title !== "Lecture unknown"
            ? item.lecture.title
            : `lecture_${item.lecture.id}`;
    const cleanLecture = vtt.sanitizeFilename(rawTitle);
    const outputPath = path.join(
        config.transcriptsDir,
        cleanSection,
        `${cleanLecture}.txt`,
    );

    const ok = await vtt.processVideo(videoId, outputPath);
    if (ok) {
        Logger.info(
            `[Worker ${workerId}] ✓ Done: ${cleanLecture} (${segmentCount} segments)`,
        );
    } else {
        Logger.warn(
            `[Worker ${workerId}] ✗ No transcript generated: ${item.lecture.title}`,
        );
    }
    return ok;
}

// ============================================================================
// Worker pool orchestrator
// ============================================================================

/**
 * Spawns `options.concurrency` workers, each in its own isolated
 * `BrowserContext` seeded with the shared session cookies. Workers are
 * staggered by 3 seconds each to avoid simultaneous cold-start CDN pressure.
 *
 * All workers pull from a single shared queue (FIFO, safe due to JS's
 * single-threaded event loop). Failed lectures are collected and logged in a
 * summary when all workers finish.
 */
export async function runWorkerPool(
    browser: Browser,
    cookies: CookieParam[],
    loginUrl: string,
    queue: QueueItem[],
    options: WorkerPoolOptions,
): Promise<void> {
    Logger.info(`Spawning ${options.concurrency} worker(s)...`);

    const sharedQueue = [...queue];
    const failed: QueueItem[] = [];

    const workers = Array.from(
        { length: options.concurrency },
        async (_, i) => {
            if (i > 0) await new Promise((r) => setTimeout(r, i * 3000));

            const context = await createWorkerContext(
                browser,
                cookies,
                loginUrl,
            );
            const page = await context.newPage();
            try {
                while (sharedQueue.length > 0) {
                    const item = sharedQueue.shift();
                    if (!item) break;

                    Logger.info(
                        `[Worker ${i}] → [${item.section}] ${item.lecture.title}`,
                    );
                    const ok = await processLecture(page, item, {
                        seek: options.seek,
                        workerId: i,
                    });
                    if (!ok) failed.push(item);
                }
            } finally {
                await context.close();
            }
        },
    );

    await Promise.all(workers);

    const succeeded = queue.length - failed.length;
    Logger.info(`\n========================================`);
    Logger.info(
        `Run complete: ${succeeded}/${queue.length} lectures succeeded.`,
    );
    if (failed.length > 0) {
        Logger.warn(`${failed.length} lecture(s) failed or were skipped:`);
        for (const item of failed) {
            Logger.warn(`  - [${item.section}] ${item.lecture.title}`);
        }
    }
    Logger.info(`========================================`);
}
