import { AutomationCoordinator } from "./AutomationCoordinator";
import { LectureProcessor } from "./LectureProcessor";
import { BrowserService } from "../core/BrowserService";
import { ConfigService } from "../core/ConfigService";
import { ConsoleLogger } from "../core/Logger";
import { VttInterceptor } from "../interceptor/VttInterceptor";
import { TeachablePlatform } from "../platform/TeachablePlatform";
import { VttParser } from "../transcript/VttParser";

async function main() {
    const debug = process.argv.includes("--debug");

    // 1. Core Services
    const logger = new ConsoleLogger();
    const config = new ConfigService();

    // 2. Browser Service
    const browserService = new BrowserService(logger, {
        headless: !debug,
        debug: debug,
        proxy: config.proxy,
    });

    // 3. Platform
    const platform = new TeachablePlatform(config, logger);

    // 4. Processing Components
    const interceptor = new VttInterceptor(config, logger);
    const parser = new VttParser(config, logger);
    const lectureProcessor = new LectureProcessor(
        interceptor,
        parser,
        config,
        logger,
    );

    // 5. Coordinator
    const coordinator = new AutomationCoordinator(
        browserService,
        platform,
        config,
        logger,
        lectureProcessor,
    );

    try {
        await coordinator.runScraper();
    } catch (error) {
        logger.error(`Scraper failed: ${error}`);
        process.exit(1);
    } finally {
        await browserService.close();
    }
}

if (require.main === module) {
    main().catch(console.error);
}
