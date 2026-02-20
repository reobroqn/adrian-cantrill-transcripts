import * as path from "node:path";
import type { HTTPResponse, Page } from "puppeteer";
import {
    closeBrowser,
    createWorkerContext,
    extractCookies,
    launchBrowser,
} from "./core/browser";
import { parsePlayArgs } from "./core/cli";
import { config } from "./core/config";
import { Logger } from "./core/logger";
import type { Lecture } from "./core/types";
import { buildLectureQueue, loadManifest } from "./services/manifest";
import type { QueueItem } from "./services/manifest";
import * as subtitle from "./services/subtitle";
import * as teachable from "./services/teachable";
import * as player from "./services/player";
import * as vtt from "./services/vtt";

// ============================================================================
// Lecture processing (orchestrates navigation, subtitles, VTT capture, transcript)
// ============================================================================

async function processLecture(
    page: Page,
    item: { section: string; lecture: Lecture },
    options: { seek: boolean; workerId: number } = { seek: false, workerId: 0 },
): Promise<boolean> {
    const { workerId } = options;
    let videoId: string | null = null;
    let segmentCount = 0;

    const onResponse = async (response: HTTPResponse) => {
        const url = response.url();
        const match = url.match(/\/video\/([^/]+)\/hls\//);
        if (match?.[1]) videoId = match[1];

        const before = segmentCount;
        await vtt.handleVttResponse(response);
        // handleVttResponse saves to disk; if the file was new, count it
        if (url.includes(".webvtt") && response.status() === 200) segmentCount++;
    };

    page.on("response", onResponse);

    try {
        await page.goto(item.lecture.url, {
            waitUntil: "networkidle2",
            timeout: 60000,
        });

        const playing = await player.ensurePlaying(page);
        if (!playing) {
            Logger.warn(`[Worker ${workerId}] No video found — skipping: ${item.lecture.title}`);
            return false;
        }

        // Capture Video ID ASAP
        let attempts = 0;
        while (!videoId && attempts < 15) {
            await new Promise((r) => setTimeout(r, 1000));
            attempts++;
        }

        if (!videoId) {
            Logger.warn(`[Worker ${workerId}] Video ID not captured after ${attempts}s — skipping: ${item.lecture.title}`);
            return false;
        }

        // Now set subtitles
        await subtitle.selectEnglishSubtitles(page);

        Logger.info(`[Worker ${workerId}] [${videoId}] Processing: ${item.lecture.title}`);

        if (options.seek) {
            const frame = await player.findVideoFrame(page);
            if (frame) {
                const duration = await frame.evaluate(() => {
                    const v = document.querySelector("video");
                    return v ? v.duration : 0;
                });

                if (duration > 0) {
                    const totalJumps = Math.ceil(duration / 60);
                    for (let t = 0; t <= duration; t += 60) {
                        await frame.evaluate((seekTime: number) => {
                            const v = document.querySelector("video");
                            if (v) v.currentTime = seekTime;
                        }, t);
                        await new Promise((r) => setTimeout(r, 4000));

                        // Periodic progress every 5 jumps
                        const jump = Math.round(t / 60) + 1;
                        if (jump % 5 === 0 || jump === totalJumps) {
                            Logger.info(`[Worker ${workerId}] [${videoId}] Seek ${jump}/${totalJumps} — ${segmentCount} segments captured`);
                        }
                    }
                }
            }
        } else {
            await player.waitForFinished(page);
        }

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
            Logger.info(`[Worker ${workerId}] ✓ Done: ${cleanLecture} (${segmentCount} segments)`);
            return true;
        } else {
            Logger.warn(`[Worker ${workerId}] ✗ No transcript generated: ${item.lecture.title}`);
            return false;
        }
    } catch (err) {
        Logger.error(`[Worker ${workerId}] Error on "${item.lecture.title}": ${err}`);
        return false;
    } finally {
        page.off("response", onResponse);
    }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
    const args = parsePlayArgs();

    const browser = await launchBrowser({
        headless: !args.debug,
        debug: args.debug,
    });

    try {
        const manifest = await loadManifest();
        const queue = buildLectureQueue(manifest, {
            session: args.session,
            batchSize: args.batchSize,
        });

        if (queue.length === 0) {
            Logger.warn("No lectures to process.");
            return;
        }

        Logger.info(`Starting playback for ${queue.length} lectures with concurrency=${args.concurrency}`);

        // Login once on a temporary setup page in the default context,
        // then extract cookies to share with all isolated worker contexts.
        const { setupPage, loginUrl } = await (async () => {
            const { createPage } = await import("./core/browser");
            const p = await createPage(browser);
            await teachable.ensureLoggedIn(p);
            const url = new URL(p.url());
            return { setupPage: p, loginUrl: `${url.protocol}//${url.host}` };
        })();

        const cookies = await extractCookies(setupPage);
        await setupPage.close();

        Logger.info(`Session captured (${cookies.length} cookies). Spawning ${args.concurrency} worker(s)...`);

        // Track lectures that failed so we can report them at the end.
        const failed: QueueItem[] = [];
        const failedMutex = { push: (item: QueueItem) => failed.push(item) };

        // Worker Pool — each worker gets its OWN isolated BrowserContext
        // seeded with the shared login cookies. Workers are staggered by 3s
        // to avoid hammering the CDN / login session simultaneously on cold start.
        const sharedQueue = [...queue];
        const workers = Array.from({ length: args.concurrency }, async (_, i) => {
            // Stagger startup: worker 0 starts immediately, worker 1 after 3s, etc.
            if (i > 0) await new Promise((r) => setTimeout(r, i * 3000));

            const context = await createWorkerContext(browser, cookies, loginUrl);
            const page = await context.newPage();
            try {
                while (sharedQueue.length > 0) {
                    const item = sharedQueue.shift();
                    if (!item) break;

                    Logger.info(`[Worker ${i}] → [${item.section}] ${item.lecture.title}`);
                    const ok = await processLecture(page, item, { seek: args.seek, workerId: i });
                    if (!ok) failedMutex.push(item);
                }
            } finally {
                // Closing the context also closes all its pages cleanly
                await context.close();
            }
        });

        await Promise.all(workers);

        // Summary report
        const succeeded = queue.length - failed.length;
        Logger.info(`\n========================================`);
        Logger.info(`Run complete: ${succeeded}/${queue.length} lectures succeeded.`);
        if (failed.length > 0) {
            Logger.warn(`${failed.length} lecture(s) failed or were skipped:`);
            for (const item of failed) {
                Logger.warn(`  - [${item.section}] ${item.lecture.title}`);
            }
        }
        Logger.info(`========================================`);

    } catch (error) {
        Logger.error(`Player failed: ${error}`);
        process.exit(1);
    } finally {
        await closeBrowser(browser);
    }
}

if (require.main === module) {
    main().catch(console.error);
}
