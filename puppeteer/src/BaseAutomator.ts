import puppeteer, { Browser, Page } from 'puppeteer';
import path from 'path';
import fs from 'fs/promises';

export interface AutomatorOptions {
    debug?: boolean;
    headless?: boolean;
    email?: string;
    password?: string;
    courseId?: string;
    proxy?: string;
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
        this.dataDir = path.join(__dirname, '..', 'data');
        this.configDir = path.join(__dirname, '..', 'config');
        this.browser = null;
        this.page = null;
        this.email = options.email || '';
        this.password = options.password || '';
        this.courseId = options.courseId || '';
        this.proxy = options.proxy;
    }

    async init(): Promise<boolean> {
        try {
            await fs.mkdir(this.dataDir, { recursive: true });

            const args = [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ];

            if (this.proxy) {
                args.push(`--proxy-server=${this.proxy}`);
                args.push('--ignore-certificate-errors');
            }

            this.browser = await puppeteer.launch({
                headless: this.headless,
                devtools: this.debug,
                args: args,
                defaultViewport: {
                    width: 1920,
                    height: 1080
                }
            });

            this.page = await this.browser.newPage();

            await this.page.setUserAgent(
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
            );

            return true;
        } catch (error) {
            console.error('Error initializing browser:', error);
            return false;
        }
    }

    async login(): Promise<boolean> {
        try {
            if (!this.page) return false;

            if (!this.email || !this.password) {
                console.error('Email and password are required for login.');
                return false;
            }

            console.log('Navigating to login page...');
            await this.page.goto('https://sso.teachable.com/secure/212820/identity/login/password?force=true', { waitUntil: 'networkidle2' });

            // Wait for autofill to settle
            await new Promise(r => setTimeout(r, 3000));

            // Check if already logged in (redirected)
            if (!this.page.url().includes('login')) {
                console.log('Already logged in or redirected.');
                return true;
            }

            console.log('Filling credentials...');
            await this.page.waitForSelector('#email', { visible: true });

            // Clear and type email (Robust JS clear for React/Autofill)
            await this.page.evaluate(() => {
                const el = document.querySelector('#email') as HTMLInputElement;
                el.value = '';
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
            });
            await this.page.type('#email', this.email);

            // Clear and type password
            await this.page.evaluate(() => {
                const el = document.querySelector('#password') as HTMLInputElement;
                el.value = '';
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
            });
            await this.page.type('#password', this.password);

            const submitSelector = 'input[type="submit"], button[type="submit"], input.btn-primary.button';
            await this.page.waitForSelector(submitSelector, { visible: true });

            console.log('Submitting login form...');
            await Promise.all([
                this.page.waitForNavigation({ waitUntil: 'networkidle2' }),
                this.page.click(submitSelector)
            ]);

            const currentUrl = this.page.url();
            if (currentUrl.includes('sign_in') || currentUrl.includes('login')) {
                console.error('Still on sign in page. Login might have failed.');
                await this.page.screenshot({ path: path.join(this.dataDir, 'login_failed.png') });
                console.error(`Screenshot saved to ${path.join(this.dataDir, 'login_failed.png')}`);
                return false;
            }

            return true;
        } catch (error) {
            console.error('Error during login:', error);
            return false;
        }
    }

    async cleanup(): Promise<void> {
        if (this.browser) {
            await this.browser.close();
        }
    }
}
