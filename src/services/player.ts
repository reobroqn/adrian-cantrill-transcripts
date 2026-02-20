import type { Frame, Page } from "puppeteer";
import { Logger } from "../core/logger";

const FRAME_URL_PATTERNS = ["hotmart", "wistia", "player"];

const SELECTORS = {
    VIDEO: "video",
    PLAY_BUTTON: 'button[aria-label*="Play"]',
    VIDEO_JS: ".video-js",
    ENDED_CLASS: "vjs-ended",
};

/**
 * Polls page.frames() until a matching player iframe appears or the timeout
 * expires. This is necessary because networkidle2 only waits for the outer
 * page — the Hotmart iframe continues loading asynchronously after that.
 */
export async function findVideoFrame(
    page: Page,
    timeoutMs = 10_000,
    intervalMs = 500,
): Promise<Frame | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        for (const frame of page.frames()) {
            const url = frame.url();
            if (FRAME_URL_PATTERNS.some((pattern) => url.includes(pattern))) {
                return frame;
            }
        }
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    return null;
}

export async function ensurePlaying(page: Page): Promise<boolean> {
    const frame = await findVideoFrame(page);
    if (!frame) return false;

    try {
        await frame.evaluate((selectors) => {
            const v = document.querySelector(
                selectors.VIDEO,
            ) as HTMLVideoElement;
            if (v) {
                v.currentTime = 0;
                v.muted = true;
                v.play().catch(() => { });
            }
        }, SELECTORS);

        // Wait a bit and verify
        await new Promise((r) => setTimeout(r, 2000));

        const isPlaying = await frame.evaluate((selectors) => {
            const v = document.querySelector(
                selectors.VIDEO,
            ) as HTMLVideoElement;
            return v && !v.paused;
        }, SELECTORS);

        if (!isPlaying) {
            // Secondary attempt - click play button
            const playBtn = await frame.$(SELECTORS.PLAY_BUTTON);
            if (playBtn) {
                await frame.evaluate(
                    (b) => (b as HTMLElement).click(),
                    playBtn,
                );
                await new Promise((r) => setTimeout(r, 1000));
            }
        }

        return true;
    } catch (e) {
        Logger.error(`Error controlling video: ${e}`);
        return false;
    }
}

export async function waitForFinished(
    page: Page,
    timeoutMs: number = 3_600_000,
): Promise<boolean> {
    const frame = await findVideoFrame(page);
    if (!frame) return false;

    try {
        // Use the browser's native polling instead of a manual while-loop.
        // waitForFunction re-evaluates the predicate every `polling` ms until
        // it returns truthy or the timeout is reached.
        await frame.waitForFunction(
            (selectors) => {
                const v = document.querySelector(
                    selectors.VIDEO,
                ) as HTMLVideoElement;
                if (!v) return false;
                const player = document.querySelector(selectors.VIDEO_JS);
                return (
                    v.ended ||
                    player?.classList.contains(selectors.ENDED_CLASS) ||
                    (v.duration > 0 && v.currentTime >= v.duration - 1)
                );
            },
            { timeout: timeoutMs, polling: 5000 },
            SELECTORS,
        );
        return true;
    } catch {
        // waitForFunction throws on timeout — treat as a non-fatal failure
        Logger.warn("waitForFinished: timed out waiting for video to end.");
        return false;
    }
}
