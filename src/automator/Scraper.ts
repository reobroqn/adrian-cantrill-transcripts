import fs from "node:fs/promises";
import path from "node:path";
import { type AutomatorOptions, BaseAutomator } from "./BaseAutomator";

export class Scraper extends BaseAutomator {
    private manifestPath: string;

    constructor(options: AutomatorOptions) {
        super(options);
        this.manifestPath = path.join(this.dataDir, "course_manifest.json");
    }

    async run(): Promise<boolean> {
        if (!(await this.init())) return false;
        if (!(await this.login())) {
            await this.cleanup();
            return false;
        }

        const success = await this.scrapeCourse();
        await this.cleanup();
        return success;
    }

    async scrapeCourse(): Promise<boolean> {
        if (!this.page || !this.courseId) return false;

        const courseUrl = `https://learn.cantrill.io/courses/enrolled/${this.courseId}`;
        console.log(`Navigating to course page: ${courseUrl}`);

        await this.page.goto(courseUrl, { waitUntil: "networkidle2" });

        // Wait for course sections
        try {
            await this.page.waitForSelector(".course-section", {
                timeout: 10000,
            });
            console.log("Found .course-section elements");
        } catch (_e) {
            console.log(
                "Could not find .course-section, verifying page content...",
            );
        }

        // Take screenshot for debugging
        await this.page.screenshot({
            path: path.join(this.dataDir, "scraper_debug.png"),
            fullPage: true,
        });
        console.log(
            `Screenshot saved to ${path.join(this.dataDir, "scraper_debug.png")}`,
        );

        // Log what selectors are available
        const debugInfo = await this.page.evaluate(() => {
            const possibleSelectors = [
                ".course-section",
                ".section",
                '[class*="section"]',
                '[class*="curriculum"]',
                '[class*="course"]',
            ];

            const results: Record<string, number> = {};
            for (const selector of possibleSelectors) {
                results[selector] = document.querySelectorAll(selector).length;
            }

            return {
                selectors: results,
                bodyClasses: document.body.className,
                url: window.location.href,
            };
        });

        await fs.writeFile(
            path.join(this.dataDir, "scraper_debug.json"),
            JSON.stringify(debugInfo, null, 2),
        );
        console.log("Debug info:", JSON.stringify(debugInfo, null, 2));

        // Scrape
        const sections = await this.page.evaluate(() => {
            interface LectureData {
                id: string;
                title: string;
                url: string;
            }
            interface SectionData {
                section_title: string;
                lectures: LectureData[];
            }

            const data: SectionData[] = [];
            const debugLog: string[] = [];
            const sectionContainers =
                document.querySelectorAll(".course-section");

            debugLog.push(
                `Found ${sectionContainers.length} .course-section elements`,
            );

            for (const section of Array.from(sectionContainers)) {
                // Try to find section title with various selectors
                const titleEl =
                    section.querySelector(".section-title") ||
                    section.querySelector("h3") ||
                    section.querySelector("h2") ||
                    section.querySelector("[class*='title']");

                let sectionTitle =
                    titleEl?.textContent?.trim() || "Unknown Section";
                sectionTitle = sectionTitle.replace(/\s+/g, " ");

                debugLog.push(`\nSection: "${sectionTitle}"`);
                debugLog.push(`  Classes: ${section.className}`);

                const lectures: LectureData[] = [];

                // Try multiple selector patterns for lectures
                let lectureElements = section.querySelectorAll(
                    "ul.section-list li.section-item",
                );
                if (lectureElements.length === 0) {
                    lectureElements = section.querySelectorAll(
                        "li[class*='lecture']",
                    );
                }
                if (lectureElements.length === 0) {
                    lectureElements = section.querySelectorAll(
                        "li[data-lecture-id]",
                    );
                }
                if (lectureElements.length === 0) {
                    lectureElements = section.querySelectorAll(
                        "a[href*='lectures']",
                    );
                }

                debugLog.push(
                    `  Found ${lectureElements.length} lecture elements`,
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
                                title: title,
                                url: link.href,
                            });
                        }
                    }
                }

                debugLog.push(`  Extracted ${lectures.length} lectures`);

                if (lectures.length > 0) {
                    data.push({
                        section_title: sectionTitle,
                        lectures: lectures,
                    });
                }
            }

            // Store debug log in window for retrieval
            (
                window as Window & { __scraperDebugLog?: string }
            ).__scraperDebugLog = debugLog.join("\n");

            return data;
        });

        // Retrieve and save debug log
        const scraperLog = await this.page.evaluate(() => {
            return (
                (window as Window & { __scraperDebugLog?: string })
                    .__scraperDebugLog || "No debug log found"
            );
        });

        await fs.writeFile(
            path.join(this.dataDir, "scraper_detailed_debug.log"),
            scraperLog,
        );
        console.log(
            `Detailed debug log saved to ${path.join(this.dataDir, "scraper_detailed_debug.log")}`,
        );

        console.log(`Scraped ${sections.length} sections.`);
        await fs.writeFile(
            this.manifestPath,
            JSON.stringify({ sections }, null, 2),
        );
        console.log(`Manifest saved to ${this.manifestPath}`);

        return true;
    }
}

// CLI Execution
async function main() {
    const automator = new Scraper({
        debug: process.argv.includes("--debug"),
        headless: !process.argv.includes("--debug"),
        email: process.env.EMAIL,
        password: process.env.PASSWORD,
        courseId: process.env.COURSE_ID || "1820301",
    });

    const success = await automator.run();
    process.exit(success ? 0 : 1);
}

if (require.main === module) {
    main().catch(console.error);
}
