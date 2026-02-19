import * as fs from "node:fs/promises";
import { config } from "../core/config";
import type { Lecture, Manifest } from "../core/types";

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
        const target = options.session.toLowerCase();
        const section = manifest.sections.find((s) =>
            s.section_title.toLowerCase().includes(target),
        );
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
        const batchSize = options.batchSize || 1;
        queue = queue.slice(0, batchSize);
    }

    return queue;
}
