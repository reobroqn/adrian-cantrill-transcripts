import type { Browser, Page } from "puppeteer";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { Logger } from "./Logger";

puppeteer.use(StealthPlugin());

export interface BrowserOptions {
    headless?: boolean;
    debug?: boolean;
    proxy?: string;
}

export class BrowserService {
    private browser: Browser | null = null;

    constructor(private options: BrowserOptions = {}) {}

    async init(): Promise<Browser> {
        if (this.browser) return this.browser;

        const args = [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-accelerated-2d-canvas",
            "--no-first-run",
            "--no-zygote",
            "--disable-gpu",
        ];

        if (this.options.proxy) {
            Logger.info(`Using Proxy: ${this.options.proxy}`);
            args.push(`--proxy-server=${this.options.proxy}`);
            args.push("--ignore-certificate-errors");
        }

        this.browser = (await puppeteer.launch({
            headless: this.options.headless !== false,
            devtools: this.options.debug,
            args: args,
            defaultViewport: {
                width: 1920,
                height: 1080,
            },
        })) as unknown as Browser;

        Logger.info("Browser initialized.");
        return this.browser;
    }

    async createPage(): Promise<Page> {
        if (!this.browser) {
            await this.init();
        }
        if (!this.browser) {
            throw new Error("Failed to initialize browser.");
        }
        return await this.browser.newPage();
    }

    async close(): Promise<void> {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            Logger.info("Browser closed.");
        }
    }

    getBrowser(): Browser | null {
        return this.browser;
    }
}
