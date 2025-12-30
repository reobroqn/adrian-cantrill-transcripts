import type { Frame, Page } from "puppeteer";
import { Logger } from "../core/Logger";

export class VideoPlayerController {
    constructor(private page: Page) {}

    async findVideoFrame(): Promise<Frame | null> {
        const frames = this.page.frames();
        for (const frame of frames) {
            const url = frame.url();
            if (
                url.includes("hotmart") ||
                url.includes("wistia") ||
                url.includes("player")
            ) {
                return frame;
            }
        }
        return null;
    }

    async ensurePlaying(): Promise<boolean> {
        const frame = await this.findVideoFrame();
        if (!frame) return false;

        try {
            await frame.evaluate(() => {
                const v = document.querySelector("video");
                if (v) {
                    v.currentTime = 0;
                    v.muted = true;
                    v.play().catch(() => {});
                }
            });

            // Wait a bit and verify
            await new Promise((r) => setTimeout(r, 2000));

            const isPlaying = await frame.evaluate(() => {
                const v = document.querySelector("video");
                return v && !v.paused;
            });

            if (!isPlaying) {
                // Secondary attempt - click play button
                const playBtn = await frame.$('button[aria-label*="Play"]');
                if (playBtn) {
                    await frame.evaluate((b) => b.click(), playBtn);
                    await new Promise((r) => setTimeout(r, 1000));
                }
            }

            return true;
        } catch (e) {
            Logger.error(`Error controlling video: ${e}`);
            return false;
        }
    }

    async waitForFinished(timeoutMs: number = 3600000): Promise<boolean> {
        const frame = await this.findVideoFrame();
        if (!frame) return false;

        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const state = await frame.evaluate(() => {
                const v = document.querySelector("video");
                if (!v) return null;
                const player = document.querySelector(".video-js");
                return {
                    ended: v.ended || player?.classList.contains("vjs-ended"),
                    currentTime: v.currentTime,
                    duration: v.duration,
                };
            });

            if (
                state &&
                (state.ended ||
                    (state.duration > 0 &&
                        state.currentTime >= state.duration - 1))
            ) {
                return true;
            }

            await new Promise((r) => setTimeout(r, 5000));
        }
        return false;
    }
}
