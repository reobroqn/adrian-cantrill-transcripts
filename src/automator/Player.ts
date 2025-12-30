import { BrowserService } from "../core/BrowserService";
import { Logger } from "../core/Logger";
import { TeachablePlatform } from "../platform/TeachablePlatform";
import { AutomationCoordinator } from "./AutomationCoordinator";

async function main() {
    const args = process.argv.slice(2);
    const debug = args.includes("--debug");

    let targetSession: string | undefined;
    const sessionIdx = args.indexOf("--session");
    if (sessionIdx !== -1) targetSession = args[sessionIdx + 1];

    let batchSize = 1;
    const batchIdx = args.indexOf("--batch-size");
    if (batchIdx !== -1) batchSize = parseInt(args[batchIdx + 1], 10);

    const browserService = new BrowserService({
        headless: !debug,
        debug: debug,
        proxy: process.env.PROXY,
    });

    const platform = new TeachablePlatform();
    const coordinator = new AutomationCoordinator(browserService, platform);

    try {
        await coordinator.runPlayer({
            batchSize,
            targetSession,
        });
    } catch (error) {
        Logger.error(`Player failed: ${error}`);
        process.exit(1);
    } finally {
        await browserService.close();
    }
}

if (require.main === module) {
    main().catch(console.error);
}
