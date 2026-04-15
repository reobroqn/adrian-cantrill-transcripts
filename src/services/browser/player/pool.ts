import type { Page } from "puppeteer";
import type { QueueItem, WorkerPoolOptions } from "../../../types";
import { Logger } from "../../../utils/logger";
import { processLecture } from "./pipeline";

/**
 /**
  * Spawns `options.concurrency` workers.
  *
  * Worker 0 will reuse the provided `page`. Subsequent workers will create new pages
  * in the same browser context. All workers pull from a single shared queue.
  */
export async function runWorkerPool(
    queue: QueueItem[],
    { concurrency, seek, direct }: WorkerPoolOptions,
    page: Page,
): Promise<void> {
    if (queue.length === 0) {
        Logger.warn("No lectures to process.");
        return;
    }

    Logger.info(
        `Starting playback for ${queue.length} lectures with concurrency=${concurrency}, direct=${!!direct}`,
    );
    Logger.info(`Spawning ${concurrency} worker(s)...`);

    const sharedQueue = [...queue];
    const failed: QueueItem[] = [];

    const workers = Array.from({ length: concurrency }, async (_, i) => {
        // Stagger startup to avoid simultaneous CDN pressure/SSO flags
        if (i > 0) {
            const delay = i * 3000 + Math.random() * 2000;
            await new Promise((r) => setTimeout(r, delay));
        }

        const workerPage =
            i === 0 ? page : await page.browserContext().newPage();

        try {
            while (sharedQueue.length > 0) {
                const item = sharedQueue.shift();
                if (!item) break;

                Logger.info(
                    `[Worker ${i}] → [${item.section}] ${item.lecture.title}`,
                );
                const ok = await processLecture(workerPage, item, {
                    seek,
                    workerId: i,
                    direct,
                });
                if (!ok) failed.push(item);
            }
        } catch (err) {
            Logger.error(`[Worker ${i}] Fatal error: ${err}`);
        } finally {
            await workerPage.close();
        }
    });

    await Promise.all(workers);

    await Promise.all(workers);

    const succeeded = queue.length - failed.length;
    Logger.info(`========================================`);
    Logger.info(
        `Run complete: ${succeeded}/${queue.length} lectures succeeded.`,
    );
    if (failed.length > 0) {
        Logger.warn(`${failed.length} lecture(s) failed or were skipped:`);
        for (const item of failed) {
            Logger.warn(`  - [${item.section}] ${item.lecture.title}`);
        }
    }
    Logger.info(`========================================`);
}
