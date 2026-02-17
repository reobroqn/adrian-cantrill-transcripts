import * as path from "node:path";
import type { HTTPResponse, Page } from "puppeteer";
import { closeBrowser, createPage, launchBrowser } from "./core/browser";
import { parsePlayArgs } from "./core/cli";
import { config } from "./core/config";
import { Logger } from "./core/logger";
import type { Lecture } from "./core/types";
import { buildLectureQueue, loadManifest } from "./services/manifest";
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
): Promise<void> {
    let videoId: string | null = null;

    const onResponse = async (response: HTTPResponse) => {
        const url = response.url();
        const match = url.match(/\/video\/([^/]+)\/hls\//);
        if (match?.[1]) videoId = match[1];
        await vtt.handleVttResponse(response);
    };

    page.on("response", onResponse);

    try {
        await page.goto(item.lecture.url, {
            waitUntil: "networkidle2",
            timeout: 60000,
        });

        await subtitle.selectEnglishSubtitles(page);

        if (await player.ensurePlaying(page)) {

            // Wait for the video ID to be captured from a network request
            let attempts = 0;
            while (!videoId && attempts < 10) {
                await new Promise((r) => setTimeout(r, 1000));
                attempts++;
            }

            if (!videoId) {
                Logger.warn(`No video ID captured for: ${item.lecture.title}`);
                return;
            }

            Logger.info(`Captured Video ID: ${videoId}. Waiting for completion...`);
            await player.waitForFinished(page);

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
                Logger.info("Transcript generated.");
            } else {
                Logger.warn(`Transcript generation failed for: ${item.lecture.title}`);
            }
        }
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

        const page = await createPage(browser);
        await teachable.ensureLoggedIn(page);

        for (const item of queue) {
            Logger.info(`Processing: [${item.section}] ${item.lecture.title}`);
            await processLecture(page, item);
        }

        await page.close();
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
