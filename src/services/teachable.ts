import type { Page } from "puppeteer";
import { config } from "../core/config";
import { Logger } from "../core/logger";
import type { Lecture, Manifest, Section } from "../core/types";

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
    // Confirmed from live DOM: li.section-item are direct children of ul.section-list
    LECTURE_ITEM: "li.section-item",
    LECTURE_NAME: "span.lecture-name",
};

export async function isLoggedIn(page: Page): Promise<boolean> {
    await page.goto(URLS.BASE, {
        waitUntil: "networkidle2",
    });
    const url = page.url();
    return !url.includes("login") && !url.includes("sign_in");
}

export async function login(page: Page): Promise<boolean> {
    Logger.info("Attempting login to Teachable...");

    await page.goto(URLS.LOGIN, {
        waitUntil: "networkidle2",
    });

    // Wait for potential autofill
    await new Promise((r) => setTimeout(r, 2000));

    Logger.info("Filling credentials...");
    await page.waitForSelector(SELECTORS.EMAIL_INPUT, { visible: true });

    await page.evaluate(
        (email, selector) => {
            const el = document.querySelector(selector) as HTMLInputElement;
            if (el) {
                el.value = email;
                el.dispatchEvent(new Event("input", { bubbles: true }));
            }
        },
        config.email,
        SELECTORS.EMAIL_INPUT,
    );

    await page.evaluate(
        (password, selector) => {
            const el = document.querySelector(selector) as HTMLInputElement;
            if (el) {
                el.value = password;
                el.dispatchEvent(new Event("input", { bubbles: true }));
            }
        },
        config.password,
        SELECTORS.PASSWORD_INPUT,
    );

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

export async function ensureLoggedIn(page: Page): Promise<void> {
    if (!(await isLoggedIn(page))) {
        if (!(await login(page))) {
            throw new Error("Failed to login to Teachable.");
        }
    }
}

export async function scrapeCourse(
    page: Page,
    courseId: string,
): Promise<Manifest> {
    const courseUrl = URLS.COURSE(courseId);
    Logger.info(`Scraping course from: ${courseUrl}`);

    await page.goto(courseUrl, { waitUntil: "networkidle2" });
    await page.waitForSelector(SELECTORS.COURSE_SECTION, { timeout: 10000 });

    const sections = await page.evaluate(
        (selectors) => {
            const data: Section[] = [];
            const sectionContainers = document.querySelectorAll(
                selectors.COURSE_SECTION,
            );

            for (const section of Array.from(sectionContainers)) {
                const titleEl = section.querySelector(selectors.SECTION_TITLE);

                // From live DOM: .section-title has multiple direct text nodes
                // (surrounding whitespace, the actual title, whitespace).
                // Pick the longest trimmed node — that's always the real title.
                const sectionTitle = titleEl
                    ? Array.from(titleEl.childNodes)
                        .filter((n) => n.nodeType === Node.TEXT_NODE)
                        .map((n) => (n.textContent?.trim() ?? ""))
                        .reduce((a, b) => (b.length > a.length ? b : a), "")
                    || "Unknown Section"
                    : "Unknown Section";

                const lectures: Lecture[] = [];
                const lectureElements = section.querySelectorAll(
                    selectors.LECTURE_ITEM,
                );

                for (const item of Array.from(lectureElements)) {
                    // Confirmed from live DOM: data-lecture-id is on the li element
                    const lectureId =
                        item.getAttribute("data-lecture-id") ||
                        item.getAttribute("data-id") ||
                        (item as HTMLElement).dataset.lectureId;

                    // Confirmed: the link always has class "item"
                    const link = item.querySelector("a.item") as HTMLAnchorElement | null;
                    if (!link) continue;

                    const finalId = lectureId || link.href.split("/").pop() || "";
                    if (!finalId) continue;

                    // Confirmed: span.lecture-name contains title + duration with
                    // newlines inside the parens, e.g. "Public Introduction\n  \n    (4:04\n  )"
                    // On the public/redirect page there is no span.lecture-name — the title
                    // is a direct text node inside the anchor instead.
                    const nameEl = link.querySelector(selectors.LECTURE_NAME);
                    let rawTitle: string;
                    if (nameEl) {
                        rawTitle = nameEl.textContent?.trim() || "";
                    } else {
                        // Fall back to direct text nodes of the anchor (public page DOM)
                        rawTitle = Array.from(link.childNodes)
                            .filter((n) => n.nodeType === Node.TEXT_NODE)
                            .map((n) => n.textContent?.trim() ?? "")
                            .reduce((a, b) => (b.length > a.length ? b : a), "");
                    }
                    if (!rawTitle) rawTitle = `lecture_${finalId}`;

                    const title = rawTitle
                        .replace(/\(\d+:\d+[\s\S]*?\)/g, "") // strip duration (may span lines)
                        .replace(/\s+/g, " ")
                        .trim();

                    lectures.push({ id: finalId, title, url: link.href });
                }

                if (lectures.length > 0) {
                    data.push({ section_title: sectionTitle, lectures });
                }
            }
            return data;
        },
        {
            COURSE_SECTION: SELECTORS.COURSE_SECTION,
            SECTION_TITLE: SELECTORS.SECTION_TITLE,
            LECTURE_ITEM: SELECTORS.LECTURE_ITEM,
            LECTURE_NAME: SELECTORS.LECTURE_NAME,
        },
    );

    return { course_id: courseId, sections };
}
