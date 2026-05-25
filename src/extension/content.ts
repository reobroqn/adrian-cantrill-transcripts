/**
 * content.ts - Runs directly on learn.cantrill.io
 */

const SCRAPER_SELECTORS = {
    COURSE_SECTION: ".course-section",
    SECTION_TITLE: ".section-title",
    LECTURE_ITEM: "li.section-item",
    LECTURE_NAME: "span.lecture-name",
};

interface IframeDetails {
    videoId: string;
    queryParams: string;
    iframeSrc: string;
}

function scrapeManifest() {
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

    function extractLectures(sectionEl: Element) {
        const lectures: any[] = [];
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

    const data: any[] = [];
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
    // 1. Try to find in the page source (scripts)
    const scripts = Array.from(document.querySelectorAll("script"));
    for (const script of scripts) {
        const content = script.textContent || "";
        const match = content.match(/\/(?:video|embed)\/([^/"]+)/);
        if (match) return match[1];
    }

    // 2. Try to find any element with a data-video-id
    const el = document.querySelector("[data-video-id]");
    if (el) return el.getAttribute("data-video-id");

    return null;
}

function sanitizeFilename(raw: string): string {
    return raw.replace(/[<>:"/\\|?*]/g, "_").trim();
}

/**
 * UI Injection logic (Premium Glassmorphism Design)
 */
function injectUI() {
    if (document.getElementById("adrian-scraper-ui")) return;

    const card = document.createElement("div");
    card.id = "adrian-scraper-ui";
    card.style.position = "fixed";
    card.style.bottom = "20px";
    card.style.right = "20px";
    card.style.zIndex = "99999";
    card.style.display = "flex";
    card.style.flexDirection = "column";
    card.style.gap = "10px";
    card.style.padding = "16px";
    card.style.background = "rgba(28, 28, 35, 0.85)";
    card.style.backdropFilter = "blur(12px)";
    card.style.webkitBackdropFilter = "blur(12px)";
    card.style.border = "1px solid rgba(255, 255, 255, 0.08)";
    card.style.borderRadius = "12px";
    card.style.boxShadow = "0 8px 32px rgba(0, 0, 0, 0.35)";
    card.style.fontFamily =
        "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    card.style.color = "#f3f4f6";
    card.style.width = "220px";

    // Header Title
    const header = document.createElement("div");
    header.style.fontWeight = "700";
    header.style.fontSize = "14px";
    header.style.color = "#ffffff";
    header.style.letterSpacing = "0.5px";
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.gap = "6px";
    header.innerHTML = "<span>🍊</span> Adrian Scraper";
    card.appendChild(header);

    // Status text
    const statusEl = document.createElement("div");
    statusEl.id = "adrian-status";
    statusEl.style.fontSize = "11px";
    statusEl.style.color = "#9ca3af";
    statusEl.style.marginBottom = "4px";
    statusEl.innerText = "Status: Ready";
    card.appendChild(statusEl);

    // Progress Bar Container
    const progContainer = document.createElement("div");
    progContainer.id = "adrian-progress-container";
    progContainer.style.display = "none";
    progContainer.style.width = "100%;";
    progContainer.style.height = "4px";
    progContainer.style.background = "rgba(255, 255, 255, 0.1)";
    progContainer.style.borderRadius = "2px";
    progContainer.style.overflow = "hidden";
    progContainer.style.marginBottom = "4px";

    const progBar = document.createElement("div");
    progBar.id = "adrian-progress-bar";
    progBar.style.width = "0%";
    progBar.style.height = "100%";
    progBar.style.background = "#3b82f6";
    progBar.style.transition = "width 0.3s ease";

    progContainer.appendChild(progBar);
    card.appendChild(progContainer);

    // 1. Scan Course Button (Amber/Orange)
    const scanBtn = createModernButton(
        "🔍 Scan Course",
        "#d97706",
        "#b45309",
        () => {
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
    );
    card.appendChild(scanBtn);

    // 2. Download Current Button (Emerald/Green)
    const downloadBtn = createModernButton(
        "💾 Download Current",
        "#059669",
        "#047857",
        async () => {
            updateStatus("Sniffing...");
            const iframeDetails = findHotmartIframe();
            let videoId = iframeDetails?.videoId || null;
            let computedMasterUrl = null;

            if (iframeDetails) {
                console.log(
                    `[Adrian Scraper] Sniffed iframe. videoId=${videoId}`,
                );
            } else {
                videoId = await findVideoIdFallback();
                console.log(
                    `[Adrian Scraper] No iframe. Fallback videoId=${videoId}`,
                );
            }

            // If videoId is a short embed ID (length < 20), do not treat it as the final videoId.
            // We want to query the background worker for the actual CDN UUID that was intercepted!
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

            // Construct computedMasterUrl only if we have a valid UUID (length >= 20) and iframe details
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
    );
    card.appendChild(downloadBtn);

    // 3. Download All Button (Blue/Royal)
    const downloadAllBtn = createModernButton(
        "📥 Download All",
        "#2563eb",
        "#1d4ed8",
        () => {
            updateStatus("Starting Bulk...");
            chrome.runtime.sendMessage(
                { type: "START_BULK_DOWNLOAD" },
                (res) => {
                    if (!res?.ok) {
                        updateStatus("Ready");
                        alert(res?.error || "Failed to start bulk download.");
                    }
                },
            );
        },
    );
    downloadAllBtn.id = "adrian-download-all-btn";
    card.appendChild(downloadAllBtn);

    // 4. Cancel Bulk Button (Red/Danger)
    const cancelBtn = createModernButton(
        "❌ Cancel Bulk",
        "#ef4444",
        "#dc2626",
        () => {
            chrome.runtime.sendMessage({ type: "CANCEL_BULK_DOWNLOAD" });
        },
    );
    cancelBtn.id = "adrian-cancel-btn";
    cancelBtn.style.display = "none";
    card.appendChild(cancelBtn);

    document.body.appendChild(card);

    // Restore progress UI if bulk download is active
    chrome.storage.local.get(["bulk_download_state"], (result) => {
        const state = result.bulk_download_state;
        if (state?.active) {
            showProgress(state.completedCount, state.queue.length);
        }
    });
}

function createModernButton(
    text: string,
    bgColor: string,
    hoverBgColor: string,
    onClick: () => void,
) {
    const btn = document.createElement("button");
    btn.innerText = text;
    btn.style.width = "100%";
    btn.style.padding = "8px 12px";
    btn.style.backgroundColor = bgColor;
    btn.style.color = "white";
    btn.style.border = "none";
    btn.style.borderRadius = "6px";
    btn.style.cursor = "pointer";
    btn.style.fontWeight = "600";
    btn.style.fontSize = "12px";
    btn.style.transition = "all 0.2s ease";
    btn.style.boxShadow = "0 1px 3px rgba(0,0,0,0.1)";

    btn.onmouseover = () => {
        btn.style.backgroundColor = hoverBgColor;
        btn.style.transform = "translateY(-1px)";
        btn.style.boxShadow = "0 4px 6px rgba(0,0,0,0.15)";
    };
    btn.onmouseout = () => {
        btn.style.backgroundColor = bgColor;
        btn.style.transform = "translateY(0)";
        btn.style.boxShadow = "0 1px 3px rgba(0,0,0,0.1)";
    };
    btn.onclick = onClick;
    return btn;
}

function updateStatus(status: string) {
    const el = document.getElementById("adrian-status");
    if (el) el.innerText = `Status: ${status}`;
}

function showProgress(completedCount: number, total: number) {
    const statusEl = document.getElementById("adrian-status");
    if (statusEl) {
        statusEl.innerText = `Bulk: ${completedCount}/${total}`;
    }
    const container = document.getElementById("adrian-progress-container");
    const bar = document.getElementById("adrian-progress-bar");
    if (container && bar) {
        container.style.display = "block";
        const percent = Math.min(
            100,
            Math.max(0, (completedCount / total) * 100),
        );
        bar.style.width = `${percent}%`;
    }
    const cancelBtn = document.getElementById("adrian-cancel-btn");
    if (cancelBtn) {
        cancelBtn.style.display = "block";
    }
    const downloadAllBtn = document.getElementById("adrian-download-all-btn");
    if (downloadAllBtn) {
        downloadAllBtn.style.display = "none";
    }
}

function showFinished() {
    const statusEl = document.getElementById("adrian-status");
    if (statusEl) {
        statusEl.innerText = "Status: Completed!";
    }
    const container = document.getElementById("adrian-progress-container");
    if (container) {
        container.style.display = "none";
    }
    const cancelBtn = document.getElementById("adrian-cancel-btn");
    if (cancelBtn) {
        cancelBtn.style.display = "none";
    }
    const downloadAllBtn = document.getElementById("adrian-download-all-btn");
    if (downloadAllBtn) {
        downloadAllBtn.style.display = "block";
    }
    alert("Bulk download completed!");
}

function showCancelled() {
    const statusEl = document.getElementById("adrian-status");
    if (statusEl) {
        statusEl.innerText = "Status: Cancelled";
    }
    const container = document.getElementById("adrian-progress-container");
    if (container) {
        container.style.display = "none";
    }
    const cancelBtn = document.getElementById("adrian-cancel-btn");
    if (cancelBtn) {
        cancelBtn.style.display = "none";
    }
    const downloadAllBtn = document.getElementById("adrian-download-all-btn");
    if (downloadAllBtn) {
        downloadAllBtn.style.display = "block";
    }
    alert("Bulk download cancelled.");
}

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

    // Filter out short embed IDs
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

    // Construct computedMasterUrl only if we have a valid UUID and iframe details
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
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "AUTOMATION_PROCESS_LECTURE") {
        processCurrentPageForAutomation()
            .then((result) => sendResponse(result))
            .catch((err) =>
                sendResponse({ success: false, reason: err.message }),
            );
        return true; // Keep channel open
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
});

// Initialize
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectUI);
} else {
    injectUI();
}

window.addEventListener("message", (event) => {
    if (event.data?.type === "DEBUG_GET_DOWNLOAD_HISTORY") {
        chrome.runtime.sendMessage(
            { type: "GET_DOWNLOAD_HISTORY" },
            (response) => {
                console.log("DEBUG_DOWNLOAD_HISTORY_RESPONSE:", response);
            },
        );
    }
});
