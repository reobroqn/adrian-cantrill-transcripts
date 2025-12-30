import { BrowserService } from "../core/BrowserService";
import { Logger } from "../core/Logger";
import { TeachablePlatform } from "../platform/TeachablePlatform";
import { AutomationCoordinator } from "./AutomationCoordinator";

async function main() {
    const debug = process.argv.includes("--debug");

    const browserService = new BrowserService({
        headless: !debug,
        debug: debug,
        proxy: process.env.PROXY,
    });

    const platform = new TeachablePlatform();
    const coordinator = new AutomationCoordinator(browserService, platform);

    try {
        await coordinator.runScraper();
    } catch (error) {
        Logger.error(`Scraper failed: ${error}`);
        process.exit(1);
    } finally {
        await browserService.close();
    }
}

if (require.main === module) {
    main().catch(console.error);
}
