import { closeBrowser, createPage, launchBrowser } from "./core/browser";
import { parseScrapeArgs } from "./core/cli";
import { config } from "./core/config";
import { Logger } from "./core/logger";
import { saveManifest } from "./services/manifest";
import * as teachable from "./services/teachable";

async function main() {
    const args = parseScrapeArgs();

    const browser = await launchBrowser({
        headless: !args.debug,
        debug: args.debug,
    });

    try {
        const page = await createPage(browser);

        await teachable.ensureLoggedIn(page);

        const manifest = await teachable.scrapeCourse(page, config.courseId);
        await saveManifest(manifest);

        Logger.info(`Manifest saved to ${config.manifestPath}`);

        await page.close();
    } catch (error) {
        Logger.error(`Scraper failed: ${error}`);
        process.exit(1);
    } finally {
        await closeBrowser(browser);
    }
}

if (require.main === module) {
    main().catch(console.error);
}
