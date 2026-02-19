/**
 * convert.ts — Batch-convert all downloaded vtt_segments into transcripts.
 *
 * Scans data/vtt_segments/ for every <videoId> folder and calls the
 * existing processVideo() function on each one, writing the result to
 * data/transcripts/<videoId>.txt
 *
 * Usage:
 *   npm run convert               — convert all video IDs
 *   npm run convert -- --id <id>  — convert a single video ID
 *   npm run convert -- --debug    — verbose logging
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { parseConvertArgs } from "./core/cli";
import { config } from "./core/config";
import { Logger } from "./core/logger";
import { processVideo } from "./services/vtt";

async function main() {
    const args = parseConvertArgs();

    if (!fs.existsSync(config.vttDir)) {
        Logger.error(`VTT segments directory not found: ${config.vttDir}`);
        process.exit(1);
    }

    // Collect the video IDs to process
    let videoIds: string[];

    if (args.id) {
        // Single video ID passed explicitly
        videoIds = [args.id];
    } else {
        // Scan all subdirectories of vtt_segments/
        videoIds = fs
            .readdirSync(config.vttDir, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name);
    }

    if (videoIds.length === 0) {
        Logger.warn("No VTT segments found to convert.");
        return;
    }

    Logger.info(`Found ${videoIds.length} video(s) to convert.`);

    let converted = 0;
    let skipped = 0;
    let failed = 0;

    for (const videoId of videoIds) {
        const outputPath = path.join(config.transcriptsDir, `${videoId}.txt`);

        if (fs.existsSync(outputPath) && !args.force) {
            Logger.info(`[skip] ${videoId} — transcript already exists`);
            skipped++;
            continue;
        }

        Logger.info(`[convert] ${videoId}`);
        const ok = await processVideo(videoId, outputPath);

        if (ok) {
            Logger.info(`[done]    ${videoId} → ${path.relative(process.cwd(), outputPath)}`);
            converted++;
        } else {
            Logger.warn(`[failed]  ${videoId} — no segments or parse error`);
            failed++;
        }
    }

    Logger.info(
        `Conversion complete: ${converted} converted, ${skipped} skipped, ${failed} failed.`,
    );
}

if (require.main === module) {
    main().catch(console.error);
}
