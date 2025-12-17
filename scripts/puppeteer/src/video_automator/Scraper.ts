import { BaseAutomator, AutomatorOptions } from './BaseAutomator';
import fs from 'fs/promises';
import path from 'path';

export class Scraper extends BaseAutomator {
    private manifestPath: string;

    constructor(options: AutomatorOptions) {
        super(options);
        this.manifestPath = path.join(this.dataDir, 'course_manifest.json');
    }

    async run(): Promise<boolean> {
        if (!await this.init()) return false;
        if (!await this.login()) {
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

        await this.page.goto(courseUrl, { waitUntil: 'networkidle2' });

        // Wait for course sections
        try {
            await this.page.waitForSelector('.course-section', { timeout: 10000 });
        } catch (e) {
            console.log('Could not find .course-section, verifying page content...');
        }

        // Scrape
        const sections = await this.page.evaluate(() => {
            const data: any[] = [];
            const sectionContainers = document.querySelectorAll('.course-section');

            sectionContainers.forEach(section => {
                const titleEl = section.querySelector('.section-title');
                let sectionTitle = titleEl?.textContent?.trim() || 'Unknown Section';
                sectionTitle = sectionTitle.replace(/\s+/g, ' ');

                const lectures: any[] = [];
                const lectureElements = section.querySelectorAll('ul.section-list li.section-item');

                lectureElements.forEach(item => {
                    const lectureId = item.getAttribute('data-lecture-id');
                    const link = item.querySelector('a.item') as HTMLAnchorElement;

                    if (lectureId && link) {
                        let title = link.querySelector('.lecture-name')?.textContent?.trim() || `Lecture ${lectureId}`;
                        title = title.replace(/\(\d+:\d+\)$/, '').trim().replace(/\s+/g, ' ');

                        lectures.push({
                            id: lectureId,
                            title: title,
                            url: link.href
                        });
                    }
                });

                if (lectures.length > 0) {
                    data.push({ section_title: sectionTitle, lectures: lectures });
                }
            });
            return data;
        });

        console.log(`Scraped ${sections.length} sections.`);
        await fs.writeFile(this.manifestPath, JSON.stringify({ sections }, null, 2));
        console.log(`Manifest saved to ${this.manifestPath}`);

        return true;
    }
}

// CLI Execution
async function main() {
    const automator = new Scraper({
        debug: process.argv.includes('--debug'),
        headless: !process.argv.includes('--debug'),
        email: process.env.EMAIL,
        password: process.env.PASSWORD,
        courseId: process.env.COURSE_ID || '1820301'
    });

    const success = await automator.run();
    process.exit(success ? 0 : 1);
}

if (require.main === module) {
    main().catch(console.error);
}
