/**
 * subtitle.ts — Hotmart player subtitle interaction.
 *
 * Responsible solely for selecting English subtitles via the Hotmart
 * player iframe UI. Selectors confirmed via live browser inspection of
 * player.hotmart.com.
 */
import type { Page } from "puppeteer";
import { Logger } from "../core/logger";

/**
 * Interacts with the Hotmart player iframe to select English subtitles.
 * Must be called after `player.ensurePlaying()` so the player is initialised.
 */
export async function selectEnglishSubtitles(page: Page): Promise<void> {
    const frames = page.frames();
    const frame = frames.find((f) => f.url().includes("hotmart"));
    if (!frame) {
        Logger.warn("[subtitle] Hotmart player frame not found — skipping.");
        return;
    }

    try {
        // Hover the video to reveal the control bar
        const video = await frame.$("video");
        if (video) await video.hover();
        await new Promise((r) => setTimeout(r, 1000));

        // Step 1 — open subtitle menu (click via JS to bypass visibility check)
        await frame.waitForSelector('[data-testid="subtitle-settings-button"]', {
            timeout: 10000,
        });
        const opened = await frame.evaluate(() => {
            const btn = document.querySelector(
                '[data-testid="subtitle-settings-button"]',
            ) as HTMLElement | null;
            if (btn) {
                btn.click();
                return true;
            }
            return false;
        });
        if (!opened) {
            Logger.warn("[subtitle] Subtitle button not found in DOM.");
            return;
        }
        Logger.info("[subtitle] Opened subtitle menu.");
        await new Promise((r) => setTimeout(r, 600));

        // Step 2 — enable captions if the toggle is currently off
        const isOff = await frame.evaluate(() => {
            const btn = Array.from(
                document.querySelectorAll('button[role="menuitem"]'),
            ).find((el) => el.textContent?.includes("Enable caption"));
            if (!btn) return false;
            const sw = btn.querySelector('[role="switch"]');
            return sw ? !sw.className.includes("checked") : false;
        });
        if (isOff) {
            await frame.evaluate(() => {
                const btn = Array.from(
                    document.querySelectorAll('button[role="menuitem"]'),
                ).find((el) =>
                    el.textContent?.includes("Enable caption"),
                ) as HTMLElement | undefined;
                btn?.click();
            });
            Logger.info("[subtitle] Enabled captions.");
            await new Promise((r) => setTimeout(r, 600));
        }

        // Step 3 — open the Language submenu
        const langClicked = await frame.evaluate(() => {
            const btn = Array.from(
                document.querySelectorAll('button[role="menuitem"]'),
            ).find((el) =>
                el.textContent?.includes("Language"),
            ) as HTMLElement | undefined;
            if (btn) {
                btn.click();
                return true;
            }
            return false;
        });
        if (!langClicked) {
            Logger.warn("[subtitle] Language menu item not found.");
            return;
        }
        Logger.info("[subtitle] Opened language list.");
        await new Promise((r) => setTimeout(r, 600));

        // Step 4 — click English
        const englishClicked = await frame.evaluate(() => {
            const btn = Array.from(document.querySelectorAll("button")).find(
                (el) =>
                    el.getAttribute("aria-label") === "English" ||
                    el.textContent?.trim() === "English",
            ) as HTMLElement | undefined;
            if (btn) {
                btn.click();
                return true;
            }
            return false;
        });

        if (englishClicked) {
            Logger.info("[subtitle] English subtitles selected ✓");
        } else {
            Logger.warn("[subtitle] English option not found in language list.");
        }
    } catch (err) {
        Logger.warn(`[subtitle] Failed to set subtitles via UI: ${err}`);
    }
}
