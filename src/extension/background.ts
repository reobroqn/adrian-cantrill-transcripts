import { parseVttText, processSegmentsToProse } from "./vtt-processor";

console.log("Adrian Scraper: Background worker active.");

// Register declarativeNetRequest rules to spoof Referer/Origin headers for Hotmart CDN fetches
async function setupHeadersSpoofing() {
    const rules = [
        {
            id: 1,
            priority: 1,
            action: {
                type: "modifyHeaders",
                requestHeaders: [
                    {
                        header: "Referer",
                        operation: "set",
                        value: "https://player.hotmart.com/",
                    },
                    {
                        header: "Origin",
                        operation: "set",
                        value: "https://player.hotmart.com",
                    },
                ],
            },
            condition: {
                urlFilter: "*://*.hotmart.com/*",
                resourceTypes: ["xmlhttprequest"],
            },
        },
    ];

    try {
        await chrome.declarativeNetRequest.updateSessionRules({
            removeRuleIds: [1],
            addRules: rules as any,
        });
        console.log(
            "Adrian Scraper: declarativeNetRequest session rules registered successfully.",
        );
    } catch (err) {
        console.error(
            "Adrian Scraper: Failed to register declarativeNetRequest rules:",
            err,
        );
    }
}

// Call on startup
setupHeadersSpoofing();

interface QueueItem {
    section: string;
    lecture: { id: string; title: string; url: string };
}

interface BulkState {
    active: boolean;
    // Maps each active background tab ID to its assigned queue index
    tabToIndex: { [tabId: number]: number };
    // Next queue index available to be claimed by a new tab
    nextIndex: number;
    // How many items have fully completed (downloaded or skipped)
    completedCount: number;
    queue: QueueItem[];
}

// Number of tabs to run concurrently
const BULK_CONCURRENCY = 3;

function extractVideoId(url: string): string | null {
    // Try VTT pattern
    let match = url.match(/\/video\/([^/]+)\/hls\//);
    if (match) return match[1];
    // Try master.m3u8 pattern
    match = url.match(/\/video\/([^/]+)\/master\.m3u8/);
    return match ? match[1] : null;
}

// Listen for VTT and M3U8 URLs
chrome.webRequest.onCompleted.addListener(
    (details) => {
        const url = details.url;

        // Capture master.m3u8 for "direct" fetching
        if (url.includes("master.m3u8")) {
            const videoId = extractVideoId(url);
            if (videoId) {
                chrome.storage.local.set({
                    [`master_${videoId}`]: url,
                    lastCapturedVideoId: videoId,
                });
                console.log(
                    `[M3U8 Captured] Video: ${videoId} | Master playlist saved.`,
                );
            }
        }

        // Capture VTT segments (legacy/fallback)
        if (
            url.includes(".webvtt") &&
            !url.includes("textstream_pt") &&
            !url.includes("textstream_es")
        ) {
            const videoId = extractVideoId(url);
            if (videoId) {
                chrome.storage.local.set({ lastCapturedVideoId: videoId });
                chrome.storage.local.get([videoId], (result) => {
                    const existing = result[videoId] || [];
                    if (!existing.includes(url)) {
                        chrome.storage.local.set({
                            [videoId]: [...existing, url],
                        });
                        console.log(
                            `[VTT Captured] Video: ${videoId} | New segment added.`,
                        );
                    }
                });
            }
        }
    },
    { urls: ["*://*.hotmart.com/*", "*://*.teachable.com/*"] },
);

/**
 * Handle messages from Content Script
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "MANIFEST_EXTRACTED") {
        chrome.storage.local.set({ courseManifest: message.payload }, () => {
            console.log(
                `[Manifest] Saved course structure: ${message.payload.length} sections found.`,
            );
        });
        sendResponse({ ok: true });
    }

    if (message.type === "DOWNLOAD_TRANSCRIPT") {
        const { videoId, filename, masterUrl } = message.payload;
        handleDownload(videoId, filename, masterUrl)
            .then((res) => {
                if (res.ok && res.prose) {
                    saveToFile(res.prose, filename);
                    sendResponse({ ok: true });
                } else {
                    sendResponse({ ok: false, error: res.error });
                }
            })
            .catch((err) => sendResponse({ ok: false, error: err.message }));
        return true; // Keep channel open for async
    }

    if (message.type === "GET_LAST_VIDEO_ID") {
        chrome.storage.local.get(["lastCapturedVideoId"], (result) => {
            sendResponse({ videoId: result.lastCapturedVideoId });
        });
        return true; // Keep channel open for async
    }

    if (message.type === "GET_DOWNLOAD_HISTORY") {
        chrome.downloads.search({ limit: 10 }, (results) => {
            sendResponse({ results });
        });
        return true; // Keep channel open for async
    }

    if (message.type === "START_BULK_DOWNLOAD") {
        startBulkDownload().then((res) => sendResponse(res));
        return true; // Keep channel open for async
    }

    if (message.type === "CANCEL_BULK_DOWNLOAD") {
        chrome.storage.local.get(["bulk_download_state"], (result) => {
            const state = result.bulk_download_state as BulkState | undefined;
            if (state?.active) {
                chrome.storage.local.remove(["bulk_download_state"], () => {
                    // Close all active background tabs
                    for (const tabId of Object.keys(state.tabToIndex)) {
                        chrome.tabs.remove(Number(tabId)).catch(() => {});
                    }
                    broadcastMessage({ type: "BULK_CANCELLED" });
                    sendResponse({ ok: true });
                });
            } else {
                sendResponse({ ok: false });
            }
        });
        return true; // Keep channel open for async
    }
});

async function handleDownload(
    videoId: string,
    filename: string,
    masterUrl?: string,
): Promise<{ ok: boolean; prose?: string; error?: string }> {
    // 1. Try with the passed masterUrl if available
    if (masterUrl) {
        console.log(`[Direct] Trying passed master URL for ${videoId}...`);
        const res = await downloadTranscriptDirect(masterUrl, filename);
        if (res.ok) return res;
        console.warn(
            `[Direct] Passed master URL download failed for ${videoId}: ${res.error}`,
        );
    }

    // 2. Try with the stored master URL
    const result = await chrome.storage.local.get([`master_${videoId}`]);
    const storedMasterUrl = result[`master_${videoId}`];
    if (storedMasterUrl && storedMasterUrl !== masterUrl) {
        console.log(
            `[Direct] Trying stored master URL for ${videoId}: ${storedMasterUrl}`,
        );
        const res = await downloadTranscriptDirect(storedMasterUrl, filename);
        if (res.ok) return res;
    }

    // 3. Try with captured VTT segments
    const segmentsResult = await chrome.storage.local.get([videoId]);
    const urls = segmentsResult[videoId] || [];
    if (urls.length > 0) {
        console.log(
            `[Legacy] Falling back to captured segments for ${videoId}...`,
        );
        const prose = await downloadTranscript(videoId, filename);
        return prose
            ? { ok: true, prose }
            : { ok: false, error: "Legacy segment processing failed" };
    }

    const errMsg = `No successful master URL or segments found for video ${videoId}`;
    console.error(`[Error] ${errMsg}`);
    return { ok: false, error: errMsg };
}

/**
 * Directly downloads VTT segments from CDN bypassing browser playback.
 */
async function downloadTranscriptDirect(
    masterUrl: string,
    _filename: string,
): Promise<{ ok: boolean; prose?: string; error?: string }> {
    const headers = {
        Referer: "https://player.hotmart.com/",
        Origin: "https://player.hotmart.com",
    };

    try {
        const masterRes = await fetch(masterUrl, { headers });
        if (!masterRes.ok)
            throw new Error(
                `Failed to fetch master playlist: ${masterRes.status}`,
            );
        const masterContent = await masterRes.text();

        const lines = masterContent.split("\n");
        const enLine = lines.find(
            (l) => l.includes("TYPE=SUBTITLES") && l.includes('LANGUAGE="en"'),
        );
        if (!enLine)
            throw new Error(
                "No English subtitle track found in master playlist",
            );

        const uriMatch = enLine.match(/URI="([^"]+)"/);
        if (!uriMatch)
            throw new Error(
                "Could not extract subtitle URI from master playlist",
            );
        const subtitleUri = uriMatch[1];

        const baseUrl = masterUrl.substring(0, masterUrl.lastIndexOf("/") + 1);
        const subtitleUrl = subtitleUri.startsWith("http")
            ? subtitleUri
            : baseUrl + subtitleUri;

        const subRes = await fetch(subtitleUrl, { headers });
        if (!subRes.ok)
            throw new Error(
                `Failed to fetch subtitle playlist: ${subRes.status}`,
            );
        const subContent = await subRes.text();

        // The subBaseUrl is the directory of the subtitle playlist URL (where segment paths are relative to)
        const subBaseUrl = subtitleUrl.substring(
            0,
            subtitleUrl.lastIndexOf("/") + 1,
        );

        const vttUrls = subContent
            .split("\n")
            .filter((l) => l.trim() && !l.startsWith("#"))
            .map((l) => (l.startsWith("http") ? l : subBaseUrl + l));

        if (vttUrls.length === 0) {
            throw new Error("No VTT segments found in subtitle playlist");
        }

        console.log(`[Direct] Fetching ${vttUrls.length} VTT segments...`);

        const segmentContents = await Promise.all(
            vttUrls.map(async (url) => {
                const res = await fetch(url, { headers });
                if (!res.ok)
                    throw new Error(
                        `Failed to fetch VTT segment: ${res.status}`,
                    );
                return res.text();
            }),
        );

        const allSegments = segmentContents.flatMap((text) =>
            parseVttText(text),
        );
        const prose = processSegmentsToProse(allSegments);
        if (!prose || prose.trim().length === 0) {
            throw new Error("Parsed prose transcript is empty");
        }

        return { ok: true, prose };
    } catch (err: any) {
        console.error(`[Direct Error] ${err}`);
        return { ok: false, error: err.message };
    }
}

/**
 * Legacy: Fetches all captured VTT segments for a video, processes them, and returns the prose.
 */
async function downloadTranscript(
    videoId: string,
    filename: string,
): Promise<string | null> {
    try {
        const result = await chrome.storage.local.get([videoId]);
        const urls = result[videoId] || [];

        if (urls.length === 0) {
            console.error("No VTT segments found for video", videoId);
            return null;
        }

        console.log(
            `[Legacy] Processing ${urls.length} segments for ${filename}...`,
        );

        const segmentContents = await Promise.all(
            urls.map(async (url: string) => {
                const res = await fetch(url);
                return res.text();
            }),
        );

        const allSegments = segmentContents.flatMap((text) =>
            parseVttText(text),
        );
        const prose = processSegmentsToProse(allSegments);
        if (!prose || prose.trim().length === 0) {
            throw new Error("Parsed prose transcript is empty");
        }

        return prose;
    } catch (err) {
        console.error(`[Legacy Error] ${err}`);
        return null;
    }
}

function saveToFile(content: string, filename: string) {
    const dataUrl = `data:text/plain;charset=utf-8,${encodeURIComponent(content)}`;
    const cleanFilename =
        filename && filename.trim().length > 0 ? filename.trim() : "transcript";
    chrome.downloads.download({
        url: dataUrl,
        filename: `transcripts/${cleanFilename}.txt`,
        saveAs: false,
    });
}

/**
 * Bulk Scraper Automation Logic (Concurrent Batch)
 *
 * Spawns up to BULK_CONCURRENCY inactive background tabs simultaneously.
 * Each tab processes one lecture independently. When a tab finishes,
 * it claims the next available index from the shared queue until exhausted.
 */
async function startBulkDownload(): Promise<{ ok: boolean; error?: string }> {
    // Check if already active
    const stateResult = await chrome.storage.local.get(["bulk_download_state"]);
    if (stateResult.bulk_download_state?.active) {
        return { ok: false, error: "Bulk download already in progress!" };
    }

    // Get manifest
    const manifestResult = await chrome.storage.local.get(["courseManifest"]);
    const manifest = manifestResult.courseManifest;
    if (!manifest || manifest.length === 0) {
        return {
            ok: false,
            error: "Please run 'Scan Course' first to build the manifest.",
        };
    }

    // Flatten lectures
    const flatQueue: QueueItem[] = [];
    for (const section of manifest) {
        for (const lecture of section.lectures) {
            flatQueue.push({ section: section.section_title, lecture });
        }
    }

    if (flatQueue.length === 0) {
        return { ok: false, error: "No lessons found in manifest." };
    }

    const concurrency = Math.min(BULK_CONCURRENCY, flatQueue.length);

    const state: BulkState = {
        active: true,
        tabToIndex: {},
        nextIndex: concurrency, // first `concurrency` items are claimed on spawn
        completedCount: 0,
        queue: flatQueue,
    };

    // Spawn initial batch of background tabs
    for (let i = 0; i < concurrency; i++) {
        const tab = await chrome.tabs.create({
            url: flatQueue[i].lecture.url,
            active: false,
        });
        if (tab.id) {
            state.tabToIndex[tab.id] = i;
        }
    }

    await chrome.storage.local.set({ bulk_download_state: state });

    // Update status UI immediately
    broadcastMessage({
        type: "BULK_PROGRESS",
        payload: { completedCount: 0, total: flatQueue.length },
    });

    return { ok: true };
}

/**
 * Called when a single background tab finishes processing its lecture.
 * Either claims the next index in the queue (navigating the tab),
 * or closes the tab and checks if all work is done.
 */
async function advanceBulkWorker(tabId: number, state: BulkState) {
    state.completedCount++;

    if (state.nextIndex < state.queue.length) {
        // Claim next index and navigate this tab to it
        const claimedIndex = state.nextIndex;
        state.tabToIndex[tabId] = claimedIndex;
        state.nextIndex++;
        await chrome.storage.local.set({ bulk_download_state: state });

        broadcastMessage({
            type: "BULK_PROGRESS",
            payload: {
                completedCount: state.completedCount,
                total: state.queue.length,
            },
        });

        chrome.tabs.update(tabId, {
            url: state.queue[claimedIndex].lecture.url,
        });
    } else {
        // This tab has no more work; close it
        delete state.tabToIndex[tabId];
        chrome.tabs.remove(tabId).catch(() => {});

        broadcastMessage({
            type: "BULK_PROGRESS",
            payload: {
                completedCount: state.completedCount,
                total: state.queue.length,
            },
        });

        // Check if all workers are done
        if (Object.keys(state.tabToIndex).length === 0) {
            console.log(
                `[Bulk] All ${state.completedCount} transcripts downloaded.`,
            );
            await chrome.storage.local.remove(["bulk_download_state"]);
            broadcastMessage({ type: "BULK_FINISHED" });
        } else {
            await chrome.storage.local.set({ bulk_download_state: state });
        }
    }
}

function broadcastMessage(msg: any) {
    chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
            if (tab.id) {
                chrome.tabs.sendMessage(tab.id, msg).catch(() => {
                    // Ignore tabs where content script is not injected
                });
            }
        }
    });
}

// Listener for Tab Updates – fires for every tab including bulk background tabs
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, _tab) => {
    if (changeInfo.status !== "complete") return;

    const result = await chrome.storage.local.get(["bulk_download_state"]);
    const state = result.bulk_download_state as BulkState | undefined;
    if (!state || !state.active) return;

    const assignedIndex = state.tabToIndex[tabId];
    if (assignedIndex === undefined) return; // not a bulk worker tab

    console.log(
        `[Bulk] Tab ${tabId} loaded lecture ${assignedIndex + 1}/${state.queue.length}`,
    );

    // Wait for iframe/DOM to settle before instructing the content script
    setTimeout(() => {
        chrome.tabs.sendMessage(
            tabId,
            { type: "AUTOMATION_PROCESS_LECTURE", index: assignedIndex },
            async (response) => {
                if (chrome.runtime.lastError) {
                    console.error(
                        `[Bulk Error] Tab ${tabId} – content script error:`,
                        chrome.runtime.lastError,
                    );
                    // Re-fetch state in case concurrent writes happened
                    const freshResult = await chrome.storage.local.get([
                        "bulk_download_state",
                    ]);
                    const freshState = freshResult.bulk_download_state as
                        | BulkState
                        | undefined;
                    if (freshState?.active)
                        await advanceBulkWorker(tabId, freshState);
                    return;
                }

                if (response?.success) {
                    console.log(
                        `[Bulk] Tab ${tabId} – download triggered for index ${assignedIndex}`,
                    );
                } else {
                    console.warn(
                        `[Bulk Warning] Tab ${tabId} – no video at index ${assignedIndex}:`,
                        response?.reason,
                    );
                }

                // Always advance (success or skipped) after a short pace delay
                setTimeout(async () => {
                    const freshResult = await chrome.storage.local.get([
                        "bulk_download_state",
                    ]);
                    const freshState = freshResult.bulk_download_state as
                        | BulkState
                        | undefined;
                    if (freshState?.active)
                        await advanceBulkWorker(tabId, freshState);
                }, 2000);
            },
        );
    }, 3000);
});

// Listener for Tab Removal – treat unexpected removal as cancellation for that worker
chrome.tabs.onRemoved.addListener(async (tabId) => {
    const result = await chrome.storage.local.get(["bulk_download_state"]);
    const state = result.bulk_download_state as BulkState | undefined;
    if (!state || !state.active) return;

    if (!(tabId in state.tabToIndex)) return; // not one of ours

    console.log(
        `[Bulk] Worker tab ${tabId} was closed externally. Cancelling bulk download.`,
    );
    await chrome.storage.local.remove(["bulk_download_state"]);
    // Also close any remaining bulk tabs
    for (const id of Object.keys(state.tabToIndex)) {
        if (Number(id) !== tabId) {
            chrome.tabs.remove(Number(id)).catch(() => {});
        }
    }
    broadcastMessage({ type: "BULK_CANCELLED" });
});
