import type { Browser, Page } from "puppeteer";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { Logger } from "./logger";

puppeteer.use(StealthPlugin());

export interface BrowserOptions {
    headless?: boolean;
    debug?: boolean;
}

export async function launchBrowser(
    options: BrowserOptions = {},
): Promise<Browser> {
    const args = [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--disable-gpu",
    ];


    const browser = (await puppeteer.launch({
        headless: options.headless !== false,
        devtools: options.debug,
        args: args,
        defaultViewport: {
            width: 1920,
            height: 1080,
        },
    })) as unknown as Browser;

    Logger.info("Browser initialized.");
    return browser;
}

export async function createPage(browser: Browser): Promise<Page> {
    return await browser.newPage();
}

export async function closeBrowser(browser: Browser): Promise<void> {
    await browser.close();
    Logger.info("Browser closed.");
}
