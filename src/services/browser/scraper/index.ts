import type { Page } from "puppeteer";
import { config } from "../../../config";
import type { Manifest, Section } from "../../../types";
import { writeJsonFile } from "../../../utils/fs";
import { Logger } from "../../../utils/logger";
import { MANIFEST_PATH } from "../constants";
import { extractCourseStructure, navigateToCourse } from "./actions";

const URLS = {
    COURSE: (id: string) => `https://learn.cantrill.io/courses/enrolled/${id}`,
};

/**
 * Orchestrates the course manifest scraping process:
 *   1. Build URL
 *   2. Navigate and wait
 *   3. Extract DOM data
 *   4. Persist to disk
 */
export async function scrapeCourseManifest(page: Page): Promise<void> {
    const courseUrl = URLS.COURSE(config.courseId);
    Logger.info(`Scraping course from: ${courseUrl}`);

    await navigateToCourse(page, courseUrl);

    const sections = await extractCourseStructure(page);

    const manifest: Manifest = {
        course_id: config.courseId,
        sections: sections as Section[],
    };

    await writeJsonFile(MANIFEST_PATH, manifest);
    Logger.info(`Manifest saved to ${MANIFEST_PATH}`);
}
