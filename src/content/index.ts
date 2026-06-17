import type {
    CourseSection,
    ExtensionMessage,
    IframeDetails,
    Lecture,
} from "../shared/types";
import {
    injectUI,
    showCancelled,
    showFinished,
    showProgress,
    updateStatus,
} from "./ui";

const SCRAPER_SELECTORS = {
    COURSE_SECTION: ".course-section",
    SECTION_TITLE: ".section-title",
    LECTURE_ITEM: "li.section-item",
    LECTURE_NAME: "span.lecture-name",
};

function scrapeManifest(): CourseSection[] {
    function extractSectionTitle(titleEl: Element | null): string {
        if (!titleEl) return "Unknown Section";
        const longest = Array.from(titleEl.childNodes)
            .filter((n) => n.nodeType === Node.TEXT_NODE)
            .map((n) => n.textContent?.trim() ?? "")
            .reduce((a, b) => (b.length > a.length ? b : a), "");
        return longest || "Unknown Section";
    }

    function extractLectureTitle(
        link: HTMLAnchorElement,
        nameEl: Element | null,
    ): string {
        let raw: string;
        if (nameEl) {
            raw = nameEl.textContent?.trim() ?? "";
        } else {
            raw = Array.from(link.childNodes)
                .filter((n) => n.nodeType === Node.TEXT_NODE)
                .map((n) => n.textContent?.trim() ?? "")
                .reduce((a, b) => (b.length > a.length ? b : a), "");
        }
        return raw
            .replace(/\(\d+:\d+[\s\S]*?\)/g, "")
            .replace(/\s+/g, " ")
            .trim();
    }

    function extractLectures(sectionEl: Element): Lecture[] {
        const lectures: Lecture[] = [];
        for (const item of Array.from(
            sectionEl.querySelectorAll(SCRAPER_SELECTORS.LECTURE_ITEM),
        )) {
            const link = item.querySelector(
                "a.item",
            ) as HTMLAnchorElement | null;
            if (!link) continue;

            const lectureId =
                item.getAttribute("data-lecture-id") ||
                link.href.split("/").pop() ||
                "";
            if (!lectureId) continue;

            const title =
                extractLectureTitle(
                    link,
                    link.querySelector(SCRAPER_SELECTORS.LECTURE_NAME),
                ) || `lecture_${lectureId}`;
            lectures.push({ id: lectureId, title, url: link.href });
        }
        return lectures;
    }

    const data: CourseSection[] = [];
    for (const sectionEl of Array.from(
        document.querySelectorAll(SCRAPER_SELECTORS.COURSE_SECTION),
    )) {
        const section_title = extractSectionTitle(
            sectionEl.querySelector(SCRAPER_SELECTORS.SECTION_TITLE),
        );
        const lectures = extractLectures(sectionEl);
        if (lectures.length > 0) data.push({ section_title, lectures });
    }
    return data;
}

function getLectureTitle(): string {
    let title = document.querySelector("#lecture_heading")?.textContent?.trim();
    if (!title) {
        title = document.querySelector("h2")?.textContent?.trim();
    }
    if (!title) {
        title = document.querySelector(".lecture-name")?.textContent?.trim();
    }
    return title ? title.trim() : "transcript";
}

/**
 * Dynamic Iframe Sniffing
 */
function findHotmartIframe(): IframeDetails | null {
    const iframe = document.querySelector(
        "iframe[src*='hotmart.com']",
    ) as HTMLIFrameElement | null;
    if (!iframe) return null;

    const src = iframe.src || "";
    const match = src.match(/\/(?:video|embed)\/([^/?#&]+)/);
    if (!match) return null;

    const videoId = match[1];
    const queryIndex = src.indexOf("?");
    const queryParams = queryIndex !== -1 ? src.substring(queryIndex) : "";

    return { videoId, queryParams, iframeSrc: src };
}

async function findVideoIdFallback(): Promise<string | null> {
    const scripts = Array.from(document.querySelectorAll("script"));
    for (const script of scripts) {
        const content = script.textContent || "";
        const match = content.match(/\/(?:video|embed)\/([^/"]+)/);
        if (match) return match[1];
    }

    const el = document.querySelector("[data-video-id]");
    if (el) return el.getAttribute("data-video-id");

    return null;
}

function sanitizeFilename(raw: string): string {
    return raw.replace(/[<>:"/\\|?*]/g, "_").trim();
}

/**
 * Handler callbacks called by the pure UI
 */
const uiCallbacks = {
    onScan: () => {
        updateStatus("Scanning...");
        const manifest = scrapeManifest();
        const totalLectures = manifest.reduce(
            (acc, s) => acc + s.lectures.length,
            0,
        );
        console.log(
            `[Adrian Scraper] Scanned ${manifest.length} sections, ${totalLectures} lessons.`,
        );

        chrome.runtime.sendMessage(
            { type: "MANIFEST_EXTRACTED", payload: manifest },
            (response) => {
                updateStatus("Ready");
                if (response?.ok) {
                    alert(
                        `Extracted ${manifest.length} sections (${totalLectures} lessons). Data saved.`,
                    );
                }
            },
        );
    },
    onDownloadCurrent: async () => {
        updateStatus("Sniffing...");
        const iframeDetails = findHotmartIframe();
        let videoId = iframeDetails?.videoId || null;
        let computedMasterUrl = null;

        if (iframeDetails) {
            console.log(`[Adrian Scraper] Sniffed iframe. videoId=${videoId}`);
        } else {
            videoId = await findVideoIdFallback();
            console.log(
                `[Adrian Scraper] No iframe. Fallback videoId=${videoId}`,
            );
        }

        if (videoId && videoId.length < 20) {
            console.log(
                `[Adrian Scraper] Sniffed videoId ${videoId} is a short embed ID. Resetting to query background worker for UUID.`,
            );
            videoId = null;
        }

        if (!videoId) {
            console.log(
                "[Adrian Scraper] DOM video ID check failed or reset. Querying background worker...",
            );
            const response = await chrome.runtime.sendMessage({
                type: "GET_LAST_VIDEO_ID",
            });
            if (response?.videoId) {
                videoId = response.videoId;
                console.log(
                    `[Adrian Scraper] Using last captured ID from background: ${videoId}`,
                );
            }
        }

        if (videoId && videoId.length >= 20 && iframeDetails) {
            computedMasterUrl = `https://vtt-player.hotmart.com/video/${videoId}/master.m3u8${iframeDetails.queryParams}`;
        }

        if (videoId) {
            const title = getLectureTitle();
            updateStatus("Downloading...");
            chrome.runtime.sendMessage(
                {
                    type: "DOWNLOAD_TRANSCRIPT",
                    payload: {
                        videoId,
                        filename: sanitizeFilename(title),
                        masterUrl: computedMasterUrl,
                    },
                },
                (res) => {
                    updateStatus("Ready");
                    if (!res?.ok) {
                        alert(
                            `Download failed: ${res?.error || "Unknown error"}`,
                        );
                    }
                },
            );
        } else {
            updateStatus("Ready");
            alert(
                "No video ID found on this page. If this lesson has a video, play it briefly to capture.",
            );
        }
    },
    onDownloadAll: () => {
        updateStatus("Starting Bulk...");
        chrome.runtime.sendMessage({ type: "START_BULK_DOWNLOAD" }, (res) => {
            if (!res?.ok) {
                updateStatus("Ready");
                alert(res?.error || "Failed to start bulk download.");
            }
        });
    },
    onCancel: () => {
        chrome.runtime.sendMessage({ type: "CANCEL_BULK_DOWNLOAD" });
    },
};

async function processCurrentPageForAutomation(): Promise<{
    success: boolean;
    reason?: string;
}> {
    const iframeDetails = findHotmartIframe();
    let videoId = iframeDetails?.videoId || null;
    let computedMasterUrl = null;

    if (iframeDetails) {
        console.log(
            `[Adrian Scraper] Automation sniffed iframe. videoId=${videoId}`,
        );
    } else {
        videoId = await findVideoIdFallback();
    }

    if (videoId && videoId.length < 20) {
        videoId = null;
    }

    if (!videoId) {
        const response = await chrome.runtime.sendMessage({
            type: "GET_LAST_VIDEO_ID",
        });
        if (response?.videoId) {
            videoId = response.videoId;
        }
    }

    if (!videoId) {
        return {
            success: false,
            reason: "No video player or ID found on page",
        };
    }

    if (videoId && videoId.length >= 20 && iframeDetails) {
        computedMasterUrl = `https://vtt-player.hotmart.com/video/${videoId}/master.m3u8${iframeDetails.queryParams}`;
    }

    const title = getLectureTitle();

    const downloadRes = await chrome.runtime.sendMessage({
        type: "DOWNLOAD_TRANSCRIPT",
        payload: {
            videoId,
            filename: sanitizeFilename(title),
            masterUrl: computedMasterUrl,
        },
    });

    return {
        success: !!downloadRes?.ok,
        reason: downloadRes?.ok
            ? undefined
            : downloadRes?.error || "Download request failed",
    };
}

// Background event listeners
chrome.runtime.onMessage.addListener(
    (message: ExtensionMessage, _sender, sendResponse) => {
        if (message.type === "AUTOMATION_PROCESS_LECTURE") {
            processCurrentPageForAutomation()
                .then((result) => sendResponse(result))
                .catch((err) =>
                    sendResponse({ success: false, reason: err.message }),
                );
            return true;
        }

        if (message.type === "BULK_PROGRESS") {
            const { completedCount, total } = message.payload;
            showProgress(completedCount, total);
        }

        if (message.type === "BULK_FINISHED") {
            showFinished();
        }

        if (message.type === "BULK_CANCELLED") {
            showCancelled();
        }
    },
);

// Initialize
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => injectUI(uiCallbacks));
} else {
    injectUI(uiCallbacks);
}
