import puppeteer, { Browser, Page, Protocol } from 'puppeteer';
import path from 'path';
import fs from 'fs/promises';

interface AutomatorOptions {
    debug?: boolean;
    headless?: boolean;
    email?: string;
    password?: string;
}

interface Cookie {
    name: string;
    value: string;
    domain: string;
    path?: string;
    expires?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: Protocol.Network.CookieSameSite;
}

/**
 * Adrian Cantrill Course Transcript Automation
 * Phase 1: Setup and Authentication
 */
export class TranscriptAutomator {
    private debug: boolean;
    private headless: boolean;
    private dataDir: string;
    private configDir: string;
    private cookiesPath: string;
    private browser: Browser | null;
    private page: Page | null;
    private email: string;
    private password: string;

    constructor(options: AutomatorOptions = {}) {
        this.debug = options.debug || false;
        this.headless = options.headless !== false; // Default to headless mode
        // Adjust paths since we are now in src/
        this.dataDir = path.join(__dirname, '..', 'data');
        this.configDir = path.join(__dirname, '..', 'config');
        this.cookiesPath = path.join(this.dataDir, 'cookies.json');
        this.browser = null;
        this.page = null;
        this.email = options.email || '';
        this.password = options.password || '';
    }

    /**
     * Initialize the browser and create necessary directories
     */
    async init(): Promise<boolean> {
        try {
            // Create data directory if it doesn't exist
            await fs.mkdir(this.dataDir, { recursive: true });
            console.log('Data directory created/verified');

            // Launch browser with recommended settings
            this.browser = await puppeteer.launch({
                headless: this.headless,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu'
                ],
                defaultViewport: {
                    width: 1920,
                    height: 1080
                }
            });

            // Create a new page
            this.page = await this.browser.newPage();
            console.log('Browser launched successfully');

            // Set user agent to avoid bot detection
            await this.page.setUserAgent(
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            );

            return true;
        } catch (error) {
            console.error('Error initializing browser:', error);
            return false;
        }
    }

    /**
     * Perform login using username and password
     */
    async login(): Promise<boolean> {
        try {
            if (!this.page) return false;

            if (!this.email || !this.password) {
                console.error('Email and password are required for login.');
                return false;
            }

            console.log('Navigating to login page...');
            // We'll go to the standard sign in page to ensure we are there
            await this.page.goto('https://sso.teachable.com/secure/212820/identity/login/password?force=true', { waitUntil: 'networkidle2' });

            console.log('Filling credentials...');

            // Wait for selectors
            await this.page.waitForSelector('#email', { visible: true });

            // Type credentials
            await this.page.type('#email', this.email);
            await this.page.type('#password', this.password);

            // Click submit
            // Teachable usually uses input[type="submit"] or a button with class
            const submitSelector = 'input[type="submit"], button[type="submit"], input.btn-primary.button';
            await this.page.waitForSelector(submitSelector, { visible: true });

            console.log('Submitting login form...');
            await Promise.all([
                this.page.waitForNavigation({ waitUntil: 'networkidle2' }),
                this.page.click(submitSelector)
            ]);

            console.log('Login form submitted.');

            // Verify if we are redirected or if there's an error
            const currentUrl = this.page.url();
            if (currentUrl.includes('sign_in')) {
                console.error('Still on sign in page. Login might have failed.');
                return false;
            }

            return true;
        } catch (error) {
            console.error('Error during login:', error);
            return false;
        }
    }

    /**
     * Navigate to a URL and verify we're authenticated
     */
    async navigateAndAuthenticate(url: string): Promise<boolean> {
        try {
            if (!this.page) return false;

            console.log(`Navigating to: ${url}`);
            await this.page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

            // Wait a bit for any redirects
            await new Promise(resolve => setTimeout(resolve, 3000));

            // Check if we're still on the same domain
            const currentUrl = this.page.url();
            if (currentUrl.includes('login') || currentUrl.includes('signin')) {
                console.log('Authentication failed. Redirected to login page.');
                return false;
            }

            console.log('Navigation successful');
            return true;
        } catch (error) {
            console.error('Error during navigation:', error);
            return false;
        }
    }

    /**
     * Verify authentication by checking for elements that only appear when logged in
     */
    async verifyAuthentication(): Promise<boolean> {
        try {
            if (!this.page) return false;

            // Check for elements that should only be present when authenticated
            const pageContent = await this.page.content();

            // Check for indicators of authentication
            const authIndicators = [
                'user-menu',
                'profile',
                'logout',
                'account',
                'dashboard'
            ];

            // Check if we're still on the same lecture page (not redirected to login)
            const currentUrl = this.page.url();
            const isCorrectPage = currentUrl.includes('/courses/') && currentUrl.includes('/lectures/');

            // Look for any indicators in the page content
            const hasIndicators = authIndicators.some(indicator =>
                pageContent.toLowerCase().includes(indicator)
            );

            console.log('Current URL:', currentUrl);
            console.log('Is correct page format:', isCorrectPage);
            console.log('Has auth indicators:', hasIndicators);

            if (isCorrectPage || hasIndicators) {
                console.log('Authentication verified successfully');
                return true;
            } else {
                console.log('Authentication could not be verified');
                return false;
            }
        } catch (error) {
            console.error('Error verifying authentication:', error);
            return false;
        }
    }

    /**
     * Attempt to play the video on the page
     */
    async playVideo(): Promise<boolean> {
        try {
            if (!this.page) return false;
            console.log('Attempting to play video...');

            // Common selectors for Teachable/Wistia players
            // Wistia often uses a 'wistia_embed' class or similar
            const videoSelectors = [
                'video',
                '.w-video-wrapper',
                '.wistia_embed',
                'div[class*="wistia"]'
            ];

            let foundSelector = null;
            for (const selector of videoSelectors) {
                if (await this.page.$(selector)) {
                    foundSelector = selector;
                    break;
                }
            }

            if (!foundSelector) {
                console.log('No video player found.');
                return false;
            }

            // Try to click the wrapper to start playback
            console.log(`Found video player with selector: ${foundSelector}. Clicking...`);
            await this.page.click(foundSelector);

            // Wait a moment for playback to start
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Optional: specific Wistia play command if accessible, or just rely on click

            console.log('Video playback initiated (assumed).');
            return true;
        } catch (error) {
            console.error('Error playing video:', error);
            return false;
        }
    }

    /**
     * Click the "Complete and Continue" or "Next" button
     */
    async clickNext(): Promise<boolean> {
        try {
            if (!this.page) return false;
            console.log('Looking for "Next" or "Complete" button...');

            // Teachable standard "Complete and Continue" button often has id 'lecture_complete_button'
            // or class 'btn-primary' in the navigation area
            const nextSelectors = [
                '#lecture_complete_button',
                '.lecture-nav .btn-primary',
                'a[class*="next-lecture"]',
                'button[class*="complete"]'
            ];

            let foundSelector = null;
            for (const selector of nextSelectors) {
                if (await this.page.$(selector)) {
                    foundSelector = selector;
                    break;
                }
            }

            if (!foundSelector) {
                console.log('Next button not found.');
                return false;
            }

            console.log(`Found next button: ${foundSelector}. Clicking...`);
            // Ensure element is visible and clickable
            await this.page.waitForSelector(foundSelector, { visible: true });
            await this.page.click(foundSelector);

            console.log('Clicked next button.');
            // Wait for navigation
            await this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => console.log('Navigation timeout or already finished'));

            return true;

        } catch (error) {
            console.error('Error clicking next:', error);
            return false;
        }
    }

    /**
     * Main execution flow
     */
    async runFlow(url: string): Promise<boolean> {
        console.log('=== Starting Automation Flow ===');

        // Step 1: Initialize browser
        if (!await this.init()) {
            console.error('Failed at browser initialization');
            return false;
        }

        // Step 2: Login
        if (!await this.login()) {
            console.error('Failed at login');
            await this.cleanup();
            return false;
        }

        // Step 3: Navigate to URL
        if (!await this.navigateAndAuthenticate(url)) {
            console.error('Failed at navigation');
            await this.cleanup();
            return false;
        }

        // Step 4: Verify authentication
        if (!await this.verifyAuthentication()) {
            console.error('Failed at authentication verification');
            await this.cleanup();
            return false;
        }

        // Step 5: Play Video
        await this.playVideo(); // We carry on even if video play fails (maybe it's text only)

        // Wait for video duration? For now, we'll just wait a fixed amount or until user intervenes
        // Since this is "navigate to a few points, play video, click next", we assume we don't watch the whole thing
        // or maybe we do? I'll add a small delay for demo purposes.
        console.log('Watching video for 5 seconds...');
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Step 6: Click Next
        if (!await this.clickNext()) {
            console.log('Could not click next, or end of course.');
        }

        console.log('Flow completed successfully');
        return true;
    }

    /**
     * Clean up resources
     */
    async cleanup(): Promise<void> {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.page = null;
            console.log('Browser closed');
        }
    }
}

// Command line interface
async function main() {
    const args = process.argv.slice(2);
    const urlIndex = args.findIndex(arg => arg !== '--debug' && !arg.startsWith('--'));

    // Parse command line arguments
    const options: AutomatorOptions = {
        debug: args.includes('--debug'),
        headless: !args.includes('--debug'), // Debug mode implies headful browser
        email: process.env.EMAIL,
        password: process.env.PASSWORD
    };

    // Default URL for testing
    const url = urlIndex >= 0 ? args[urlIndex] : 'https://learn.cantrill.io/courses/1820301/lectures/41301611';

    // Create automator instance
    const automator = new TranscriptAutomator(options);

    // Run Flow
    const success = await automator.runFlow(url);

    // Clean up
    await automator.cleanup();

    // Exit with appropriate code
    process.exit(success ? 0 : 1);
}

// Run if called directly
if (require.main === module) {
    main().catch(error => {
        console.error('Uncaught error:', error);
        process.exit(1);
    });
}
