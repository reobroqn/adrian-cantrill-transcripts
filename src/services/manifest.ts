import * as fs from "node:fs/promises";
import { config } from "../core/config";
import type { Lecture, Manifest, Section } from "../core/types";

export interface QueueItem {
    section: string;
    lecture: Lecture;
}

export async function loadManifest(): Promise<Manifest> {
    const data = await fs.readFile(config.manifestPath, "utf-8");
    return JSON.parse(data);
}

export async function saveManifest(manifest: Manifest): Promise<void> {
    await fs.writeFile(config.manifestPath, JSON.stringify(manifest, null, 2));
}

export function buildLectureQueue(
    manifest: Manifest,
    options: { session?: string; batchSize?: number },
): QueueItem[] {
    let queue: QueueItem[] = [];

    if (options.session) {
        let section: Section | undefined;
        const index = parseInt(options.session, 10);

        if (!Number.isNaN(index)) {
            // Numeric index (1-based)
            section = manifest.sections[index - 1];
        } else {
            // Fuzzy string search
            const target = options.session.toLowerCase();
            section = manifest.sections.find((s) =>
                s.section_title.toLowerCase().includes(target),
            );
        }

        if (section) {
            section.lectures.forEach((l) => {
                queue.push({ section: section.section_title, lecture: l });
            });
        }
    } else {
        manifest.sections.forEach((s) => {
            s.lectures.forEach((l) => {
                queue.push({ section: s.section_title, lecture: l });
            });
        });
        const batchSize = options.batchSize || 10;
        queue = queue.slice(0, batchSize);
    }

    return queue;
}

/**
 * Convenience wrapper: loads the manifest from disk and builds the queue
 * in one call, so entrypoints don't need to know about both steps.
 */
export async function buildQueue(options: {
    session?: string;
    batchSize?: number;
}): Promise<QueueItem[]> {
    const manifest = await loadManifest();
    return buildLectureQueue(manifest, options);
}
