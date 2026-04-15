import type { Page } from "puppeteer";
import { config } from "../../config";
import { Logger } from "../../utils/logger";
import { LOGIN_URL } from "./constants";

const SELECTORS = {
    EMAIL_INPUT: "#email",
    PASSWORD_INPUT: "#password",
    SUBMIT: 'input[type="submit"], button[type="submit"], input.btn-primary.button',
};

/**
 * Returns `true` when the page's current URL indicates an active session.
 * We navigate to the login page; if we are redirected away from it,
 * it means the session is already active.
 */
export async function isLoggedIn(page: Page): Promise<boolean> {
    Logger.info("Verifying session status...");
    try {
        const checkUrl = LOGIN_URL.replace("?force=true", "");
        await page.goto(checkUrl, { waitUntil: "networkidle2" });
        const currentUrl = page.url();

        if (currentUrl.includes("/login")) {
            Logger.info("Status: Not logged in (remained at login URL).");
            return false;
        }

        Logger.info(`Status: Logged in (Redirected to ${currentUrl}).`);
        return true;
    } catch (err) {
        Logger.error(`Check failed: ${err}`);
        return false;
    }
}

/**
 * Fills in `EMAIL` and `PASSWORD` from config and submits the login form.
 * Returns `true` on success, `false` if the post-submit URL is still a login page.
 */
export async function login(page: Page): Promise<boolean> {
    Logger.info(`Opening login portal: ${LOGIN_URL}`);
    await page.goto(LOGIN_URL, { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 2000)); // allow autofill to settle

    Logger.info("Waiting for email/password fields...");
    await page.waitForSelector(SELECTORS.EMAIL_INPUT, { visible: true });

    Logger.info(`Filling credentials for: ${config.email}`);
    await page.click(SELECTORS.EMAIL_INPUT, { delay: 50 });
    await page.type(SELECTORS.EMAIL_INPUT, config.email, { delay: 70 });
    await new Promise((r) => setTimeout(r, 300));

    await page.click(SELECTORS.PASSWORD_INPUT, { delay: 50 });
    await page.type(SELECTORS.PASSWORD_INPUT, config.password, { delay: 70 });
    await new Promise((r) => setTimeout(r, 500));

    Logger.info("Submitting form (simulating human hover and click)...");
    await page.hover(SELECTORS.SUBMIT);
    await new Promise((r) => setTimeout(r, 500));

    await Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle2" }),
        page.click(SELECTORS.SUBMIT, { delay: 100 }),
    ]);

    await new Promise((r) => setTimeout(r, 15000)); // allow SSO cookies to settle
    if (await isLoggedIn(page)) {
        Logger.info("Login successful.");
        return true;
    }

    Logger.error("Login failed.");
    return false;
}

/**
 * Ensures the page has an active session. If not already logged in,
 * calls `login` and throws if that also fails.
 */
export async function ensureLoggedIn(page: Page): Promise<void> {
    Logger.info("Checking authentication state...");
    const loggedIn = await isLoggedIn(page);

    if (loggedIn) {
        Logger.info("Already authenticated.");
        return;
    }

    Logger.info("Authentication required.");
    if (!(await login(page))) {
        throw new Error("Failed to login to Teachable.");
    }
}
