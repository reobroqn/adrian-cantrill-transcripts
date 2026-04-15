import type { Manifest, QueueItem, Section } from "../../../types";
import { readJsonFile } from "../../../utils/fs";
import { Logger } from "../../../utils/logger";
import { MANIFEST_PATH } from "../constants";

/**
 * Reads the course manifest from disk.
 */
export async function loadManifest(): Promise<Manifest> {
    return await readJsonFile<Manifest>(MANIFEST_PATH);
}

/**
 * Builds a queue of lectures to process based on the provided manifest
 * and filter options.
 */
export function buildLectureQueue(
    manifest: Manifest,
    { session, all }: { session?: string; all?: boolean },
): QueueItem[] {
    const queue: QueueItem[] = [];

    if (session) {
        let section: Section | undefined;
        const index = parseInt(session, 10);

        if (!Number.isNaN(index)) {
            // Numeric index (1-based)
            section = manifest.sections[index - 1];
        } else {
            // Fuzzy string search
            const target = session.toLowerCase();
            section = manifest.sections.find((s) =>
                s.section_title.toLowerCase().includes(target),
            );
        }

        if (section) {
            section.lectures.forEach((l) => {
                queue.push({ section: section.section_title, lecture: l });
            });
        } else {
            Logger.warn(`No section found matching filter: "${session}"`);
        }
    } else {
        manifest.sections.forEach((s) => {
            s.lectures.forEach((l) => {
                queue.push({ section: s.section_title, lecture: l });
            });
        });

        if (!all) {
            Logger.warn(
                "Neither SESSION nor ALL=true was provided — processing everything by default.",
            );
        }
    }

    Logger.info(`Lecture queue built with ${queue.length} items.`);
    return queue;
}
