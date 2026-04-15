/**
 * scraper.ts — DOM-level logic for extracting course structure from Teachable.
 */

export const SCRAPER_SELECTORS = {
    COURSE_SECTION: ".course-section",
    SECTION_TITLE: ".section-title",
    LECTURE_ITEM: "li.section-item",
    LECTURE_NAME: "span.lecture-name",
};

/**
 * Contains the logic that runs inside the browser context to scrape course sections and lectures.
 * This function must be self-contained and only rely on arguments passed to it.
 */
export function browserSideScraper(selectors: typeof SCRAPER_SELECTORS) {
    // ── Inner helpers (run in browser context) ────────────────────────────

    /** Extracts the human-readable section title from a .section-title node. */
    function extractSectionTitle(titleEl: Element | null): string {
        if (!titleEl) return "Unknown Section";
        const longest = Array.from(titleEl.childNodes)
            .filter((n) => n.nodeType === Node.TEXT_NODE)
            .map((n) => n.textContent?.trim() ?? "")
            .reduce((a, b) => (b.length > a.length ? b : a), "");
        return longest || "Unknown Section";
    }

    /** Parses the raw text from `span.lecture-name` or the anchor's direct text nodes. */
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
}
