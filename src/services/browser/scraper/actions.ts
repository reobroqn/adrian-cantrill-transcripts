import type { Page } from "puppeteer";
import { browserSideScraper, SCRAPER_SELECTORS } from "./logic";

/**
 * Navigates the page to the given URL and waits for the course structure to load.
 */
export async function navigateToCourse(page: Page, url: string): Promise<void> {
    await page.goto(url, { waitUntil: "networkidle2" });
    await page.waitForSelector(SCRAPER_SELECTORS.COURSE_SECTION, {
        timeout: 10000,
    });
}

/**
 * Executes the DOM-level scraper logic inside the browser page context.
 */
export async function extractCourseStructure(page: Page): Promise<unknown> {
    return await page.evaluate(browserSideScraper, SCRAPER_SELECTORS);
}
