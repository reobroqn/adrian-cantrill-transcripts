import type { Browser, Page } from "puppeteer";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { BrowserOptions } from "../../types";
import { Logger } from "../../utils/logger";

puppeteer.use(StealthPlugin());

export async function launchBrowser({
    headless = true,
    debug = false,
}: BrowserOptions = {}): Promise<Browser & AsyncDisposable> {
    const args = [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--no-first-run",
        "--no-zygote",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--disable-blink-features=AutomationControlled",
    ];

    const browser = (await puppeteer.launch({
        headless: headless !== false,
        devtools: debug,
        args: args,
        defaultViewport: {
            width: 1920,
            height: 1080,
        },
    })) as unknown as Browser;

    Logger.info("Browser initialized.");
    return Object.assign(browser, {
        [Symbol.asyncDispose]: async () => {
            await browser.close();
            Logger.info("Browser closed.");
        },
    });
}

export async function createPage(
    browser: Browser,
): Promise<Page & AsyncDisposable> {
    const page = await browser.newPage();

    await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    );
    await page.setExtraHTTPHeaders({
        "Accept-Language": "en-US,en;q=0.9",
        "sec-ch-ua":
            '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
    });
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    return Object.assign(page, {
        [Symbol.asyncDispose]: async () => {
            await page.close();
            Logger.info("Page closed automatically.");
        },
    });
}
