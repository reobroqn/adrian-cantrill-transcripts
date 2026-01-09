import * as path from "node:path";
import type { HTTPResponse, Page } from "puppeteer";
import type { ConfigService } from "../core/ConfigService";
import type { ILogger } from "../core/Logger";
import type { VttInterceptor } from "../interceptor/VttInterceptor";
import type { Lecture } from "../platform/IPlatform";
import type { VttParser } from "../transcript/VttParser";
import { VideoPlayerController } from "./VideoPlayerController";

export class LectureProcessor {
    constructor(
        private readonly interceptor: VttInterceptor,
        private readonly parser: VttParser,
        private readonly config: ConfigService,
        private readonly logger: ILogger,
    ) {}

    async process(
        page: Page,
        item: { section: string; lecture: Lecture },
    ): Promise<void> {
        const controller = new VideoPlayerController(page);
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
                    this.logger.info(
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
                    this.logger.info("Transcript generated.");
                } else {
                    this.logger.warn(
                        "Video ID not captured after playing started.",
                    );
                }
            } else {
                this.logger.warn("Could not ensure video playing.");
            }
        } finally {
            page.off("response", onResponse);
        }
    }
}
