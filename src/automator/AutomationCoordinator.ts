import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { HTTPResponse, Page } from "puppeteer";
import type { BrowserService } from "../core/BrowserService";
import { ConfigService } from "../core/ConfigService";
import { Logger } from "../core/Logger";
import { VttInterceptor } from "../interceptor/VttInterceptor";
import type { IPlatform, Lecture, Manifest } from "../platform/IPlatform";
import { VttParser } from "../transcript/VttParser";
import { VideoPlayerController } from "./VideoPlayerController";

export class AutomationCoordinator {
    private readonly config = ConfigService.getInstance();
    private readonly interceptor = new VttInterceptor();
    private readonly parser = new VttParser();

    constructor(
        private readonly browserService: BrowserService,
        private readonly platform: IPlatform,
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
            Logger.info(`Manifest saved to ${this.config.manifestPath}`);
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
        const playerController = new VideoPlayerController(page);

        try {
            if (!(await this.platform.isLoggedIn(page))) {
                await this.platform.login(page);
            }

            for (const item of queue) {
                Logger.info(
                    `Processing: [${item.section}] ${item.lecture.title}`,
                );
                await this.processLecture(page, playerController, item);
            }
        } finally {
            await page.close();
        }
    }

    private async processLecture(
        page: Page,
        controller: VideoPlayerController,
        item: { section: string; lecture: Lecture },
    ): Promise<void> {
        let videoId: string | null = null;

        const onResponse = async (response: HTTPResponse) => {
            const url = response.url();
            const match = url.match(/\/video\/([^/]+)\/hls\//);
            if (match?.[1]) videoId = match[1];
            await this.interceptor.handleResponse(response);
        };

        page.on("response", onResponse);

        try {
            await page.goto(item.lecture.url, {
                waitUntil: "networkidle2",
                timeout: 60000,
            });

            if (await controller.ensurePlaying()) {
                // Wait for video ID to be captured
                let attempts = 0;
                while (!videoId && attempts < 10) {
                    await new Promise((r) => setTimeout(r, 1000));
                    attempts++;
                }

                if (videoId) {
                    Logger.info(
                        `Captured Video ID: ${videoId}. Waiting for completion...`,
                    );
                    await controller.waitForFinished();

                    const cleanSection = item.section
                        .replace(/[<>:"/\\|?*]/g, "_")
                        .trim();
                    const cleanLecture = item.lecture.title
                        .replace(/[<>:"/\\|?*]/g, "_")
                        .trim();
                    const outputPath = path.join(
                        this.config.transcriptsDir,
                        cleanSection,
                        `${cleanLecture}.txt`,
                    );

                    await this.parser.processVideo(videoId, outputPath);
                    Logger.info("Transcript generated.");
                }
            }
        } finally {
            page.off("response", onResponse);
        }
    }
}
