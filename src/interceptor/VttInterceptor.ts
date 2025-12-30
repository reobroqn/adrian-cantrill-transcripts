import * as fs from "node:fs";
import * as path from "node:path";
import type { HTTPResponse } from "puppeteer";
import { ConfigService } from "../core/ConfigService";
import { Logger } from "../core/Logger";
import { extractVideoIdAndFilename } from "../transcript/helpers";

export class VttInterceptor {
    private readonly config = ConfigService.getInstance();

    constructor() {
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

            Logger.debug(`Saved VTT segment: ${videoId} -> ${filename}`);
        } catch (error) {
            Logger.error(`Error intercepting VTT: ${error}`);
        }
    }
}
