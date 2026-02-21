import type { Browser, BrowserContext, CookieParam, Page } from "puppeteer";
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
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
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

/**
 * Extract all cookies from a page's current browser context.
 * Used to capture the session after login and share it with worker contexts.
 */
export async function extractCookies(page: Page): Promise<CookieParam[]> {
    const cookies = await page.browserContext().cookies();
    return cookies as CookieParam[];
}

/**
 * Create an isolated BrowserContext pre-seeded with the given cookies.
 * Each worker should get its own context so pages don't compete for
 * foreground focus (bringToFront) or interfere with each other's state.
 */
export async function createWorkerContext(
    browser: Browser,
    cookies: CookieParam[],
    targetUrl: string,
): Promise<BrowserContext> {
    const context = await browser.createBrowserContext();
    const validCookies = cookies.filter(
        (c): c is CookieParam & { domain: string } =>
            typeof c.domain === "string",
    );
    if (validCookies.length > 0) {
        await context.setCookie(
            ...validCookies.map((c) => ({ ...c, url: targetUrl })),
        );
    }
    return context;
}
