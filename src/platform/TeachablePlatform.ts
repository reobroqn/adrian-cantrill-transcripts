import type { Page } from "puppeteer";
import { ConfigService } from "../core/ConfigService";
import { Logger } from "../core/Logger";
import type { IPlatform, Lecture, Manifest, Section } from "./IPlatform";

export class TeachablePlatform implements IPlatform {
    public readonly name = "Teachable";
    private readonly config = ConfigService.getInstance();

    async isLoggedIn(page: Page): Promise<boolean> {
        await page.goto("https://learn.cantrill.io/", {
            waitUntil: "networkidle2",
        });
        const url = page.url();
        return !url.includes("login") && !url.includes("sign_in");
    }

    async login(page: Page): Promise<boolean> {
        Logger.info("Attempting login to Teachable...");

        await page.goto(
            "https://sso.teachable.com/secure/212820/identity/login/password?force=true",
            {
                waitUntil: "networkidle2",
            },
        );

        // Wait for potential autofill
        await new Promise((r) => setTimeout(r, 2000));

        Logger.info("Filling credentials...");
        await page.waitForSelector("#email", { visible: true });

        await page.evaluate((email) => {
            const el = document.querySelector("#email") as HTMLInputElement;
            el.value = email;
            el.dispatchEvent(new Event("input", { bubbles: true }));
        }, this.config.email);

        await page.evaluate((password) => {
            const el = document.querySelector("#password") as HTMLInputElement;
            el.value = password;
            el.dispatchEvent(new Event("input", { bubbles: true }));
        }, this.config.password);

        const submitSelector =
            'input[type="submit"], button[type="submit"], input.btn-primary.button';
        await Promise.all([
            page.waitForNavigation({ waitUntil: "networkidle2" }),
            page.click(submitSelector),
        ]);

        if (await this.isLoggedIn(page)) {
            Logger.info("Login successful.");
            return true;
        }

        Logger.error("Login failed.");
        return false;
    }

    async scrapeCourse(page: Page, courseId: string): Promise<Manifest> {
        const courseUrl = `https://learn.cantrill.io/courses/enrolled/${courseId}`;
        Logger.info(`Scraping course from: ${courseUrl}`);

        await page.goto(courseUrl, { waitUntil: "networkidle2" });
        await page.waitForSelector(".course-section", { timeout: 10000 });

        const sections = await page.evaluate(() => {
            const data: Section[] = [];
            const sectionContainers =
                document.querySelectorAll(".course-section");

            for (const section of Array.from(sectionContainers)) {
                const titleEl =
                    section.querySelector(".section-title") ||
                    section.querySelector("h3") ||
                    section.querySelector("h2");
                const sectionTitle =
                    titleEl?.textContent?.trim() || "Unknown Section";

                const lectures: Lecture[] = [];
                const lectureElements = section.querySelectorAll(
                    "ul.section-list li.section-item, li[class*='lecture'], li[data-lecture-id], a[href*='lectures']",
                );

                for (const item of Array.from(lectureElements)) {
                    const lectureId =
                        item.getAttribute("data-lecture-id") ||
                        item.getAttribute("data-id") ||
                        (item as HTMLElement).dataset.lectureId;
                    const link = (item.querySelector("a.item") ||
                        item.querySelector("a") ||
                        (item.tagName === "A"
                            ? item
                            : null)) as HTMLAnchorElement;

                    if (link) {
                        const nameEl =
                            link.querySelector(".lecture-name") ||
                            link.querySelector("[class*='name']") ||
                            link;
                        let title =
                            nameEl?.textContent?.trim() ||
                            `Lecture ${lectureId || "unknown"}`;
                        title = title
                            .replace(/\(\d+:\d+\)$/, "")
                            .trim()
                            .replace(/\s+/g, " ");

                        const finalId =
                            lectureId || link.href.split("/").pop() || "";
                        if (finalId) {
                            lectures.push({
                                id: finalId,
                                title,
                                url: link.href,
                            });
                        }
                    }
                }

                if (lectures.length > 0) {
                    data.push({ section_title: sectionTitle, lectures });
                }
            }
            return data;
        });

        return { sections };
    }
}
