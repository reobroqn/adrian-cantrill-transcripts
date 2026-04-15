#!/usr/bin/env node

import "dotenv/config";
import { Command } from "commander";
import { runPlay, runScrape } from "./cli";
import { validateConfig } from "./config";
import { Logger } from "./utils/logger";

const program = new Command();

program
    .name("adrian-transcript")
    .description("Automation for Adrian Cantrill course transcripts")
    .version("1.0.0");

// Global setup before any command runs
program.hook("preAction", () => {
    validateConfig();
});

program
    .command("scrape")
    .description("Scrape the course manifest from Teachable")
    .option("-d, --debug", "enable headful mode and devtools", false)
    .action(async (options) => {
        await runScrape({ ...options });
    });

program
    .command("play")
    .description("Process lectures and generate transcripts")
    .option("-d, --debug", "enable headful mode and devtools", false)
    .action(async (options) => {
        await runPlay({ ...options });
    });

program.parseAsync(process.argv).catch((err) => {
    Logger.error(`Unexpected error: ${err}`);
    process.exit(1);
});
