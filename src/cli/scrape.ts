import { ensureLoggedIn } from "../services/browser/auth";
import { createPage, launchBrowser } from "../services/browser/core";
import { scrapeCourseManifest } from "../services/browser/scraper";
import type { ScrapeOptions } from "../types";

export async function runScrape({ debug = false }: ScrapeOptions) {
    await using browser = await launchBrowser({
        headless: !debug,
        debug: debug,
    });

    await using page = await createPage(browser);

    await ensureLoggedIn(page);

    await scrapeCourseManifest(page);
}
