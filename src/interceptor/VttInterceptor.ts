import * as fs from "node:fs";
import * as path from "node:path";
import type { HTTPResponse } from "puppeteer";
import type { ConfigService } from "../core/ConfigService";
import type { ILogger } from "../core/Logger";
import { extractVideoIdAndFilename } from "../transcript/helpers";

export class VttInterceptor {
    constructor(
        private readonly config: ConfigService,
        private readonly logger: ILogger,
    ) {
        fs.mkdirSync(this.config.vttDir, { recursive: true });
    }

    async handleResponse(response: HTTPResponse): Promise<void> {
        const url = response.url();

        if (!url.includes(".webvtt") || response.status() !== 200) {
            return;
        }

        try {
            const { videoId, filename } = extractVideoIdAndFilename(url);

            if (!videoId || !filename) {
                return;
            }

            const videoDir = path.join(this.config.vttDir, videoId);
            fs.mkdirSync(videoDir, { recursive: true });

            const outputFilename = path.join(videoDir, `${filename}.txt`);

            if (fs.existsSync(outputFilename)) {
                return;
            }

            const vttContent = await response.text();
            fs.writeFileSync(outputFilename, vttContent, "utf-8");

            this.logger.debug(`Saved VTT segment: ${videoId} -> ${filename}`);
        } catch (error) {
            this.logger.error(`Error intercepting VTT: ${error}`);
        }
    }
}
