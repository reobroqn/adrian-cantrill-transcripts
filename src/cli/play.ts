import { config } from "../config";
import { ensureLoggedIn } from "../services/browser/auth";
import { createPage, launchBrowser } from "../services/browser/core";
import {
    buildLectureQueue,
    loadManifest,
} from "../services/browser/player/manifest";
import { runWorkerPool } from "../services/browser/player/pool";
import type { PlayOptions } from "../types";

export async function runPlay({ debug = false, direct = false }: PlayOptions) {
    const { session, all, concurrency, seek, direct: configDirect } = config;

    await using browser = await launchBrowser({
        headless: !debug,
        debug: debug,
    });

    await using page = await createPage(browser);
    await ensureLoggedIn(page);

    const manifest = await loadManifest();
    const queue = buildLectureQueue(manifest, {
        session,
        all,
    });

    await runWorkerPool(
        queue,
        {
            concurrency,
            seek,
            direct: direct || configDirect,
        },
        page,
    );
}
