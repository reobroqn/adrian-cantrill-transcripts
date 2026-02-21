import type { Browser, CookieParam, Page } from "puppeteer";
import { createPage, extractCookies } from "../core/browser";
import { config } from "../core/config";
import { Logger } from "../core/logger";
import type { Manifest, Section } from "../core/types";

const URLS = {
    BASE: "https://learn.cantrill.io/",
    LOGIN: "https://sso.teachable.com/secure/212820/identity/login/password?force=true",
    COURSE: (id: string) => `https://learn.cantrill.io/courses/enrolled/${id}`,
};

const SELECTORS = {
    EMAIL_INPUT: "#email",
    PASSWORD_INPUT: "#password",
    SUBMIT: 'input[type="submit"], button[type="submit"], input.btn-primary.button',
    COURSE_SECTION: ".course-section",
    SECTION_TITLE: ".section-title",
    LECTURE_ITEM: "li.section-item",
    LECTURE_NAME: "span.lecture-name",
};

// ============================================================================
// Session management
// ============================================================================

export interface Session {
    cookies: CookieParam[];
    loginUrl: string;
}

/**
 * Performs a full login on a temporary page, extracts the resulting session
 * cookies, and immediately closes the page.
 *
 * Returns the cookies and the base URL (`protocol://host`) so worker contexts
 * can be seeded with the same session without re-authenticating.
 */
export async function createSession(browser: Browser): Promise<Session> {
    const setupPage = await createPage(browser);
    await ensureLoggedIn(setupPage);
    const { protocol, host } = new URL(setupPage.url());
    const loginUrl = `${protocol}//${host}`;
    const cookies = await extractCookies(setupPage);
    await setupPage.close();
    Logger.info(`Session captured (${cookies.length} cookies).`);
    return { cookies, loginUrl };
}

// ============================================================================
// Authentication
// ============================================================================

/**
 * Returns `true` when the page's current URL indicates an active session
 * (i.e. the user was not redirected to a login or sign-in page).
 */
export async function isLoggedIn(page: Page): Promise<boolean> {
    await page.goto(URLS.BASE, { waitUntil: "networkidle2" });
    const url = page.url();
    return !url.includes("login") && !url.includes("sign_in");
}

/**
 * Fills in `EMAIL` and `PASSWORD` from config and submits the login form.
 * Returns `true` on success, `false` if the post-submit URL is still a login page.
 */
export async function login(page: Page): Promise<boolean> {
    Logger.info("Attempting login to Teachable...");

    await page.goto(URLS.LOGIN, { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 2000)); // allow autofill to settle

    await page.waitForSelector(SELECTORS.EMAIL_INPUT, { visible: true });

    await fillInput(page, SELECTORS.EMAIL_INPUT, config.email);
    await fillInput(page, SELECTORS.PASSWORD_INPUT, config.password);

    await Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle2" }),
        page.click(SELECTORS.SUBMIT),
    ]);

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
    if (!(await isLoggedIn(page))) {
        if (!(await login(page))) {
            throw new Error("Failed to login to Teachable.");
        }
    }
}

// ============================================================================
// Course scraping
// ============================================================================

/**
 * Navigates to the enrolled course page and scrapes the complete section and
 * lecture structure from the DOM. Returns a `Manifest` ready to be saved.
 */
export async function scrapeCourse(
    page: Page,
    courseId: string,
): Promise<Manifest> {
    const courseUrl = URLS.COURSE(courseId);
    Logger.info(`Scraping course from: ${courseUrl}`);

    await page.goto(courseUrl, { waitUntil: "networkidle2" });
    await page.waitForSelector(SELECTORS.COURSE_SECTION, { timeout: 10000 });

    const sections = await page.evaluate((selectors) => {
        // ── Inner helpers (run in browser context) ────────────────────────────

        /** Extracts the human-readable section title from a .section-title node.
         *  The element contains multiple text nodes (whitespace + title + whitespace),
         *  so we pick the longest trimmed one. */
        function extractSectionTitle(titleEl: Element | null): string {
            if (!titleEl) return "Unknown Section";
            const longest = Array.from(titleEl.childNodes)
                .filter((n) => n.nodeType === Node.TEXT_NODE)
                .map((n) => n.textContent?.trim() ?? "")
                .reduce((a, b) => (b.length > a.length ? b : a), "");
            return longest || "Unknown Section";
        }

        /** Parses the raw text from `span.lecture-name` or the anchor's direct
         *  text nodes, then strips the trailing duration `(mm:ss)` annotation. */
        function extractLectureTitle(
            link: HTMLAnchorElement,
            nameEl: Element | null,
        ): string {
            let raw: string;
            if (nameEl) {
                raw = nameEl.textContent?.trim() ?? "";
            } else {
                // Fallback: direct text nodes on the anchor (public/preview pages)
                raw = Array.from(link.childNodes)
                    .filter((n) => n.nodeType === Node.TEXT_NODE)
                    .map((n) => n.textContent?.trim() ?? "")
                    .reduce((a, b) => (b.length > a.length ? b : a), "");
            }
            return raw
                .replace(/\(\d+:\d+[\s\S]*?\)/g, "") // strip duration like "(4:04)"
                .replace(/\s+/g, " ")
                .trim();
        }

        /** Builds the `Lecture[]` array for a single section container element. */
        function extractLectures(
            sectionEl: Element,
            selectors: { LECTURE_ITEM: string; LECTURE_NAME: string },
        ): { id: string; title: string; url: string }[] {
            const lectures: { id: string; title: string; url: string }[] = [];
            for (const item of Array.from(
                sectionEl.querySelectorAll(selectors.LECTURE_ITEM),
            )) {
                const link = item.querySelector(
                    "a.item",
                ) as HTMLAnchorElement | null;
                if (!link) continue;

                const lectureId =
                    item.getAttribute("data-lecture-id") ||
                    item.getAttribute("data-id") ||
                    (item as HTMLElement).dataset.lectureId ||
                    link.href.split("/").pop() ||
                    "";
                if (!lectureId) continue;

                const title =
                    extractLectureTitle(
                        link,
                        link.querySelector(selectors.LECTURE_NAME),
                    ) || `lecture_${lectureId}`;
                lectures.push({ id: lectureId, title, url: link.href });
            }
            return lectures;
        }

        // ── Main DOM walk ──────────────────────────────────────────────────────
        const data: {
            section_title: string;
            lectures: { id: string; title: string; url: string }[];
        }[] = [];

        for (const sectionEl of Array.from(
            document.querySelectorAll(selectors.COURSE_SECTION),
        )) {
            const section_title = extractSectionTitle(
                sectionEl.querySelector(selectors.SECTION_TITLE),
            );
            const lectures = extractLectures(sectionEl, selectors);
            if (lectures.length > 0) data.push({ section_title, lectures });
        }

        return data;
    }, SELECTORS);

    return { course_id: courseId, sections: sections as Section[] };
}

// ============================================================================
// Private helpers
// ============================================================================

/** Fills an input field via JS and fires an `input` event so React/Vue detect it. */
async function fillInput(
    page: Page,
    selector: string,
    value: string,
): Promise<void> {
    await page.evaluate(
        (sel, val) => {
            const el = document.querySelector(sel) as HTMLInputElement | null;
            if (el) {
                el.value = val;
                el.dispatchEvent(new Event("input", { bubbles: true }));
            }
        },
        selector,
        value,
    );
}
