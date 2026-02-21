import type { Frame, Page } from "puppeteer";
import { Logger } from "../core/logger";

const FRAME_URL_PATTERNS = ["hotmart", "wistia", "player"];

const SELECTORS = {
    VIDEO: "video",
    PLAY_BUTTON: 'button[aria-label*="Play"]',
    VIDEO_JS: ".video-js",
    ENDED_CLASS: "vjs-ended",
};

// ============================================================================
// Public API
// ============================================================================

/**
 * Polls `page.frames()` until a matching player iframe appears or the timeout
 * expires. Returns the frame, or `null` if not found within the time limit.
 *
 * Polling is necessary because `networkidle2` only waits for the outer page —
 * the Hotmart/Wistia player iframe continues loading asynchronously after that.
 */
export async function findVideoFrame(
    page: Page,
    timeoutMs = 10_000,
    intervalMs = 500,
): Promise<Frame | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        for (const frame of page.frames()) {
            if (FRAME_URL_PATTERNS.some((p) => frame.url().includes(p))) {
                return frame;
            }
        }
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    return null;
}

/**
 * Forces the video inside the player iframe to start playing (muted).
 * If the initial JS play() call fails, falls back to clicking the play button.
 *
 * Returns `true` if the player iframe was found and the play command was issued,
 * `false` if no matching iframe was located within the polling timeout.
 */
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
                v.play().catch(() => {});
            }
        }, SELECTORS);

        await new Promise((r) => setTimeout(r, 2000));

        const isPlaying = await frame.evaluate((selectors) => {
            const v = document.querySelector(
                selectors.VIDEO,
            ) as HTMLVideoElement;
            return v && !v.paused;
        }, SELECTORS);

        if (!isPlaying) {
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

/**
 * Waits until the video in the player iframe reaches its end state.
 * Uses `waitForFunction` with a 5-second polling interval rather than a busy loop.
 *
 * Returns `true` when the video ends, `false` on timeout (non-fatal — the
 * caller will proceed to transcript generation with whatever segments were captured).
 */
export async function waitForFinished(
    page: Page,
    timeoutMs: number = 3_600_000,
): Promise<boolean> {
    const frame = await findVideoFrame(page);
    if (!frame) return false;

    try {
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
        Logger.warn("waitForFinished: timed out waiting for video to end.");
        return false;
    }
}
