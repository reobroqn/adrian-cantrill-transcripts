import type { Frame, Page } from "puppeteer";
import { Logger } from "../core/logger";

// ============================================================================
// Private helpers
// ============================================================================

/**
 * Finds the first `button[role="menuitem"]` whose text content includes
 * `text`, clicks it, and returns whether the button was found.
 */
async function clickMenuItemByText(
    frame: Frame,
    text: string,
): Promise<boolean> {
    return frame.evaluate((searchText) => {
        const btn = Array.from(
            document.querySelectorAll('button[role="menuitem"]'),
        ).find((el) => el.textContent?.includes(searchText)) as
            | HTMLElement
            | undefined;
        if (btn) {
            btn.click();
            return true;
        }
        return false;
    }, text);
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Enables English subtitles in the Hotmart player iframe.
 *
 * The function performs four sequential UI steps:
 *   1. Opens the subtitle settings menu.
 *   2. Ensures the captions toggle is on.
 *   3. Opens the Language submenu.
 *   4. Selects "English".
 *
 * Must be called after `player.ensurePlaying()` so the player UI exists.
 * Emits one INFO line on success, one WARN on any failure path.
 */
export async function selectEnglishSubtitles(page: Page): Promise<void> {
    const frame = page.frames().find((f) => f.url().includes("hotmart"));
    if (!frame) {
        Logger.warn("[subtitle] Hotmart frame not found — skipping.");
        return;
    }

    try {
        // Reveal the player control bar by hovering over the video element
        const video = await frame.$("video");
        if (video) await video.hover();
        await new Promise((r) => setTimeout(r, 1000));

        // Step 1 — open subtitle settings menu
        await frame.waitForSelector(
            '[data-testid="subtitle-settings-button"]',
            { timeout: 10000 },
        );
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
            Logger.warn("[subtitle] Subtitle button not found — skipping.");
            return;
        }
        await new Promise((r) => setTimeout(r, 600));

        // Step 2 — enable the captions toggle if it is currently off
        await frame.evaluate(() => {
            const btn = Array.from(
                document.querySelectorAll('button[role="menuitem"]'),
            ).find((el) => el.textContent?.includes("Enable caption")) as
                | HTMLElement
                | undefined;
            if (!btn) return;
            const isOff = !btn
                .querySelector('[role="switch"]')
                ?.className.includes("checked");
            if (isOff) btn.click();
        });
        await new Promise((r) => setTimeout(r, 600));

        // Step 3 — open the Language submenu
        const langOpened = await clickMenuItemByText(frame, "Language");
        if (!langOpened) {
            Logger.warn("[subtitle] Language menu not found — skipping.");
            return;
        }
        await new Promise((r) => setTimeout(r, 600));

        // Step 4 — select English
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
            Logger.warn("[subtitle] English option not found in list.");
        }
    } catch (err) {
        Logger.warn(`[subtitle] Failed: ${err}`);
    }
}
