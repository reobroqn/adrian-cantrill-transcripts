import * as fs from "node:fs/promises";
import type { BrowserService } from "../core/BrowserService";
import type { ConfigService } from "../core/ConfigService";
import type { ILogger } from "../core/Logger";
import type { IPlatform, Lecture, Manifest } from "../platform/IPlatform";
import type { LectureProcessor } from "./LectureProcessor";

export class AutomationCoordinator {
    constructor(
        private readonly browserService: BrowserService,
        private readonly platform: IPlatform,
        private readonly config: ConfigService,
        private readonly logger: ILogger,
        private readonly lectureProcessor: LectureProcessor,
    ) {}

    async runScraper(): Promise<void> {
        const page = await this.browserService.createPage();
        try {
            if (!(await this.platform.isLoggedIn(page))) {
                if (!(await this.platform.login(page))) {
                    throw new Error("Failed to login.");
                }
            }

            const manifest = await this.platform.scrapeCourse(
                page,
                this.config.courseId,
            );
            await fs.writeFile(
                this.config.manifestPath,
                JSON.stringify(manifest, null, 2),
            );
            this.logger.info(
                `Manifest saved to ${this.config.manifestPath}`,
            );
        } finally {
            await page.close();
        }
    }

    async runPlayer(options: {
        batchSize?: number;
        startIndex?: number;
        targetSession?: string;
    }): Promise<void> {
        const manifestData = await fs.readFile(
            this.config.manifestPath,
            "utf-8",
        );
        const manifest: Manifest = JSON.parse(manifestData);

        let queue: { section: string; lecture: Lecture }[] = [];

        // Build queue logic
        if (options.targetSession) {
            const target = options.targetSession.toLowerCase();
            const session = manifest.sections.find((s) =>
                s.section_title.toLowerCase().includes(target),
            );
            if (session) {
                session.lectures.forEach((l) => {
                    queue.push({ section: session.section_title, lecture: l });
                });
            }
        } else {
            manifest.sections.forEach((s) => {
                s.lectures.forEach((l) => {
                    queue.push({ section: s.section_title, lecture: l });
                });
            });
            const start = options.startIndex || 0;
            const end = start + (options.batchSize || 1);
            queue = queue.slice(start, end);
        }

        const page = await this.browserService.createPage();

        try {
            if (!(await this.platform.isLoggedIn(page))) {
                await this.platform.login(page);
            }

            for (const item of queue) {
                this.logger.info(
                    `Processing: [${item.section}] ${item.lecture.title}`,
                );
                await this.lectureProcessor.process(page, item);
            }
        } finally {
            await page.close();
        }
    }
}
