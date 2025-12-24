import type { Browser, Page } from "puppeteer";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

puppeteer.use(StealthPlugin());

import fs from "node:fs/promises";
import path from "node:path";

export interface AutomatorOptions {
    debug?: boolean;
    headless?: boolean;
    email?: string;
    password?: string;
    courseId?: string;
    proxy?: string;
}

export enum ServiceURL {
    LOGIN = "https://sso.teachable.com/secure/212820/identity/login/password?force=true",
    HOME = "https://learn.cantrill.io/",
}

export class BaseAutomator {
    protected debug: boolean;
    protected headless: boolean;
    protected dataDir: string;
    protected configDir: string;
    protected browser: Browser | null;
    protected page: Page | null;
    protected email: string;
    protected password: string;
    protected courseId: string;
    protected proxy: string | undefined;

    constructor(options: AutomatorOptions = {}) {
        this.debug = options.debug || false;
        this.headless = options.headless !== false;
        this.dataDir = path.join(__dirname, "..", "..", "data");
        this.configDir = path.join(__dirname, "..", "..", "config");
        this.browser = null;
        this.page = null;
        this.email = options.email || "";
        this.password = options.password || "";
        this.courseId = options.courseId || "";
        this.proxy = options.proxy;
    }

    async init(): Promise<boolean> {
        try {
            await fs.mkdir(this.dataDir, { recursive: true });

            const args = [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-accelerated-2d-canvas",
                "--no-first-run",
                "--no-zygote",
                "--disable-gpu",
            ];

            if (this.proxy) {
                console.log(`Using Proxy: ${this.proxy}`);
                args.push(`--proxy-server=${this.proxy}`);
                args.push("--ignore-certificate-errors");
            }

            this.browser = (await puppeteer.launch({
                headless: this.headless,
                devtools: this.debug,
                args: args,
                defaultViewport: {
                    width: 1920,
                    height: 1080,
                },
            })) as unknown as Browser;

            this.page = await this.browser?.newPage();

            return true;
        } catch (error) {
            console.error("Error initializing browser:", error);
            return false;
        }
    }

    async saveSession(): Promise<boolean> {
        try {
            if (!this.page) return false;
            // page.cookies() is deprecated, use browserContext().cookies()
            const cookies = await this.page.browserContext().cookies();
            const localStorageData = await this.page.evaluate(() => {
                return JSON.stringify(localStorage);
            });
            const sessionData = {
                cookies,
                localStorage: localStorageData,
            };
            await fs.writeFile(
                path.join(this.dataDir, "session.json"),
                JSON.stringify(sessionData, null, 2),
            );
            console.log("Session saved.");
            return true;
        } catch (error) {
            console.error("Failed to save session:", error);
            return false;
        }
    }

    async loadSession(): Promise<boolean> {
        try {
            const sessionPath = path.join(this.dataDir, "session.json");
            try {
                await fs.access(sessionPath);
            } catch {
                console.log("No session file found.");
                return false;
            }

            const data = await fs.readFile(sessionPath, "utf8");
            const session = JSON.parse(data);

            if (this.page && session.cookies) {
                // Ensure cookies are valid CookieParam objects and use browserContext().setCookie()
                const validCookies = session.cookies.map(
                    (cookie: Record<string, unknown>) => {
                        // Filter properties if necessary, but usually passing them back works
                        const {
                            name,
                            value,
                            domain,
                            path,
                            secure,
                            httpOnly,
                            sameSite,
                            expires,
                        } = cookie;
                        return {
                            name: name as string,
                            value: value as string,
                            domain: domain as string,
                            path: path as string,
                            secure: secure as boolean,
                            httpOnly: httpOnly as boolean,
                            sameSite: sameSite as
                                | "Strict"
                                | "Lax"
                                | "None"
                                | undefined,
                            expires: expires as number,
                        };
                    },
                );
                await this.page.browserContext().setCookie(...validCookies);
            }

            if (this.page && session.localStorage) {
                await this.page.evaluateOnNewDocument((data) => {
                    const ls = JSON.parse(data);
                    for (const key in ls) {
                        localStorage.setItem(key, ls[key]);
                    }
                }, session.localStorage);
            }

            console.log("Session loaded.");
            return true;
        } catch (error) {
            console.error("Failed to load session:", error);
            return false;
        }
    }

    async login(): Promise<boolean> {
        try {
            if (!this.page) return false;

            if (!this.email || !this.password) {
                console.error("Email and password are required for login.");
                return false;
            }

            await this.loadSession();

            console.log("Verifying session...");
            await this.page.goto(ServiceURL.HOME, {
                waitUntil: "networkidle2",
            });

            // Check if we are still on the course site (not redirected to login)
            if (
                !this.page.url().includes("login") &&
                !this.page.url().includes("sign_in")
            ) {
                console.log("Already logged in (Session restored).");
                await this.saveSession(); // Refresh session file
                return true;
            }

            console.log("Session expired or not found. Navigating to login...");
            await this.page.goto(ServiceURL.LOGIN, {
                waitUntil: "networkidle2",
            });

            // Wait for autofill to settle
            await new Promise((r) => setTimeout(r, 3000));

            console.log("Filling credentials...");
            await this.page.waitForSelector("#email", { visible: true });

            // Clear and type email (Robust JS clear for React/Autofill)
            await this.page.evaluate(() => {
                const el = document.querySelector("#email") as HTMLInputElement;
                el.value = "";
                el.dispatchEvent(new Event("input", { bubbles: true }));
                el.dispatchEvent(new Event("change", { bubbles: true }));
            });
            await this.page.type("#email", this.email);

            // Clear and type password
            await this.page.evaluate(() => {
                const el = document.querySelector(
                    "#password",
                ) as HTMLInputElement;
                el.value = "";
                el.dispatchEvent(new Event("input", { bubbles: true }));
                el.dispatchEvent(new Event("change", { bubbles: true }));
            });
            await this.page.type("#password", this.password);

            const submitSelector =
                'input[type="submit"], button[type="submit"], input.btn-primary.button';
            await this.page.waitForSelector(submitSelector, { visible: true });

            console.log("Submitting login form...");
            await Promise.all([
                this.page.waitForNavigation({ waitUntil: "networkidle2" }),
                this.page.click(submitSelector),
            ]);

            const currentUrl = this.page.url();
            if (
                currentUrl.includes("sign_in") ||
                currentUrl.includes("login")
            ) {
                console.error(
                    "Still on sign in page. Login might have failed.",
                );
                await this.page.screenshot({
                    path: path.join(this.dataDir, "login_failed.png"),
                });
                console.error(
                    `Screenshot saved to ${path.join(this.dataDir, "login_failed.png")}`,
                );
                return false;
            }

            console.log("Login successful. Saving session...");
            await this.saveSession();

            return true;
        } catch (error) {
            console.error("Error during login:", error);
            return false;
        }
    }

    async cleanup(): Promise<void> {
        if (this.browser) {
            await this.browser.close();
        }
    }
}
