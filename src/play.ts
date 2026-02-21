import { closeBrowser, launchBrowser } from "./core/browser";
import { parsePlayArgs } from "./core/cli";
import { config } from "./core/config";
import { Logger } from "./core/logger";
import { buildQueue } from "./services/manifest";
import { createSession } from "./services/teachable";
import { runWorkerPool } from "./services/worker";

async function main() {
    const args = parsePlayArgs();

    const browser = await launchBrowser({
        headless: !args.debug,
        debug: args.debug,
    });

    try {
        const queue = await buildQueue({
            session: args.session,
            batchSize: config.batchSize,
        });

        if (queue.length === 0) {
            Logger.warn("No lectures to process.");
            return;
        }

        Logger.info(
            `Starting playback for ${queue.length} lectures with concurrency=${config.concurrency}`,
        );

        const { cookies, loginUrl } = await createSession(browser);

        await runWorkerPool(browser, cookies, loginUrl, queue, {
            concurrency: config.concurrency,
            seek: config.seek,
        });
    } catch (error) {
        Logger.error(`Player failed: ${error}`);
        process.exit(1);
    } finally {
        await closeBrowser(browser);
    }
}

if (require.main === module) {
    main().catch(console.error);
}
