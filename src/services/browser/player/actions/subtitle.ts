import type { Frame, Page } from "puppeteer";
import { Logger } from "../../../../utils/logger";

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
 * The function inspects the current subtitle state first:
 *   1. Opens the subtitle settings menu.
 *   2. Checks if captions are ON and Language is English.
 *   3. If already ON and English, leaves it as is.
 *   4. If OFF, toggles captions ON.
 *   5. If Language is not English, opens Language submenu and selects English.
 *
 * Must be called after `player.ensurePlaying()` so the player UI exists.
 * Emits INFO lines on state changes/success, WARN on failure paths.
 */
export async function selectEnglishSubtitles(
    page: Page,
    videoId: string,
    workerId: number,
): Promise<void> {
    const frame = page.frames().find((f) => f.url().includes("hotmart"));
    if (!frame) {
        Logger.warn(
            `[Worker ${workerId}] [${videoId}] Hotmart frame not found — skipping subtitles.`,
        );
        return;
    }

    try {
        // Reveal the player control bar by hovering over the video element
        const video = await frame.$("video");
        if (video) await video.hover();
        await new Promise((r) => setTimeout(r, 1000));

        // Step 1 — open subtitle settings menu
        const subBtnSelector =
            'button[aria-label="Subtitles"], [data-testid*="subtitle-icon"]';
        await frame.waitForSelector(subBtnSelector, { timeout: 10000 });
        const opened = await frame.evaluate((sel) => {
            const btn = document.querySelector(sel) as HTMLElement | null;
            if (btn) {
                btn.click();
                return true;
            }
            return false;
        }, subBtnSelector);

        if (!opened) {
            Logger.warn(
                `[Worker ${workerId}] [${videoId}] Subtitle button not found — skipping.`,
            );
            return;
        }
        await new Promise((r) => setTimeout(r, 1000));

        // Step 2 — Grasp current state (is ON/OFF, current language)
        const state = await frame.evaluate(() => {
            const menuitems = Array.from(
                document.querySelectorAll('button[role="menuitem"]'),
            );

            const captionBtn = menuitems.find((el) =>
                el.textContent?.includes("Enable caption"),
            );
            let isCaptionsOn = false;
            if (captionBtn) {
                const switchEl = captionBtn.querySelector('[role="switch"]');
                isCaptionsOn =
                    switchEl?.getAttribute("aria-checked") === "true";
            }

            const langBtn = menuitems.find((el) =>
                el.textContent?.includes("Language"),
            );
            let currentLanguage = "Off";
            if (langBtn) {
                const spanEl = langBtn.querySelector("span");
                if (spanEl?.textContent) {
                    currentLanguage = spanEl.textContent.trim();
                }
            }

            return { isCaptionsOn, currentLanguage };
        });

        Logger.info(
            `[Worker ${workerId}] [${videoId}] Current subtitle state: Captions=${
                state.isCaptionsOn ? "ON" : "OFF"
            }, Language=${state.currentLanguage}`,
        );

        // Condition 1: Already ON and English
        if (state.isCaptionsOn && state.currentLanguage === "English") {
            Logger.info(
                `[Worker ${workerId}] [${videoId}] English subtitles already active ✓`,
            );
            // Close the menu by clicking the subtitle button again
            await frame.evaluate((sel) => {
                const btn = document.querySelector(sel) as HTMLElement | null;
                if (btn) btn.click();
            }, subBtnSelector);
            return;
        }

        // Condition 2: Currently OFF -> turn ON
        if (!state.isCaptionsOn) {
            Logger.info(
                `[Worker ${workerId}] [${videoId}] Enabling captions toggle...`,
            );
            await frame.evaluate(() => {
                const btn = Array.from(
                    document.querySelectorAll('button[role="menuitem"]'),
                ).find((el) => el.textContent?.includes("Enable caption")) as
                    | HTMLElement
                    | undefined;
                if (btn) btn.click();
            });
            await new Promise((r) => setTimeout(r, 1000));
        }

        // Condition 3: Language is not English -> select English
        if (state.currentLanguage !== "English") {
            Logger.info(
                `[Worker ${workerId}] [${videoId}] Selecting English language...`,
            );

            // Ensure main menu is open (in case clicking Enable caption closed it)
            const isMainMenuOpen = await frame.evaluate(() => {
                return Array.from(
                    document.querySelectorAll('button[role="menuitem"]'),
                ).some((el) => el.textContent?.includes("Language"));
            });
            if (!isMainMenuOpen) {
                await frame.evaluate((sel) => {
                    const btn = document.querySelector(
                        sel,
                    ) as HTMLElement | null;
                    if (btn) btn.click();
                }, subBtnSelector);
                await new Promise((r) => setTimeout(r, 1000));
            }

            const langOpened = await clickMenuItemByText(frame, "Language");
            if (!langOpened) {
                Logger.warn(
                    `[Worker ${workerId}] [${videoId}] Language menu not found — skipping.`,
                );
                return;
            }
            await new Promise((r) => setTimeout(r, 1000));

            const englishClicked = await frame.evaluate(() => {
                const btn = Array.from(
                    document.querySelectorAll(
                        'button[role="menuitem"], button[role="menuitemradio"]',
                    ),
                ).find(
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
                Logger.info(
                    `[Worker ${workerId}] [${videoId}] English subtitles selected ✓`,
                );
            } else {
                Logger.warn(
                    `[Worker ${workerId}] [${videoId}] English option not found in list.`,
                );
            }
        } else {
            Logger.info(
                `[Worker ${workerId}] [${videoId}] English subtitles selected ✓`,
            );
            // Close the menu
            await frame.evaluate((sel) => {
                const btn = document.querySelector(sel) as HTMLElement | null;
                if (btn) btn.click();
            }, subBtnSelector);
        }
    } catch (err) {
        Logger.warn(
            `[Worker ${workerId}] [${videoId}] Subtitle Failed: ${err}`,
        );
    }
}
