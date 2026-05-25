import {
    getLastVideoId,
    getMasterPlaylistUrl,
    removeBulkState,
    setCourseManifest,
    setMasterPlaylistUrl,
} from "../shared/storage";
import type { ExtensionMessage } from "../shared/types";
import { parseVttText, processSegmentsToProse } from "../shared/vtt-processor";
import { broadcastMessage, startBulkDownload } from "./bulk";

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
            addRules: rules as unknown as chrome.declarativeNetRequest.Rule[],
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

function extractVideoId(url: string): string | null {
    let match = url.match(/\/video\/([^/]+)\/hls\//);
    if (match) return match[1];
    match = url.match(/\/video\/([^/]+)\/master\.m3u8/);
    return match ? match[1] : null;
}

// Listen for M3U8 URLs
chrome.webRequest.onCompleted.addListener(
    (details) => {
        const url = details.url;

        // Capture master.m3u8 for "direct" fetching
        if (url.includes("master.m3u8")) {
            const videoId = extractVideoId(url);
            if (videoId) {
                setMasterPlaylistUrl(videoId, url);
                console.log(
                    `[M3U8 Captured] Video: ${videoId} | Master playlist saved.`,
                );
            }
        }
    },
    { urls: ["*://*.hotmart.com/*", "*://*.teachable.com/*"] },
);

/**
 * Handle messages from Content Script or Popup
 */
chrome.runtime.onMessage.addListener(
    (message: ExtensionMessage, _sender, sendResponse) => {
        if (message.type === "MANIFEST_EXTRACTED") {
            setCourseManifest(message.payload).then(() => {
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
                .catch((err) =>
                    sendResponse({ ok: false, error: err.message }),
                );
            return true; // Keep channel open for async
        }

        if (message.type === "GET_LAST_VIDEO_ID") {
            getLastVideoId().then((videoId) => {
                sendResponse({ videoId });
            });
            return true; // Keep channel open for async
        }

        if (message.type === "START_BULK_DOWNLOAD") {
            startBulkDownload().then((res) => sendResponse(res));
            return true; // Keep channel open for async
        }

        if (message.type === "CANCEL_BULK_DOWNLOAD") {
            removeBulkState().then(() => {
                broadcastMessage({ type: "BULK_CANCELLED" });
                sendResponse({ ok: true });
            });
            return true; // Keep channel open for async
        }
    },
);

async function handleDownload(
    videoId: string,
    _filename: string,
    masterUrl?: string | null,
): Promise<{ ok: boolean; prose?: string; error?: string }> {
    // 1. Try with the passed masterUrl if available
    if (masterUrl) {
        console.log(`[Direct] Trying passed master URL for ${videoId}...`);
        const res = await downloadTranscriptDirect(masterUrl);
        if (res.ok) return res;
        console.warn(
            `[Direct] Passed master URL download failed for ${videoId}: ${res.error}`,
        );
    }

    // 2. Try with the stored master URL
    const storedMasterUrl = await getMasterPlaylistUrl(videoId);
    if (storedMasterUrl && storedMasterUrl !== masterUrl) {
        console.log(
            `[Direct] Trying stored master URL for ${videoId}: ${storedMasterUrl}`,
        );
        const res = await downloadTranscriptDirect(storedMasterUrl);
        if (res.ok) return res;
    }

    const errMsg = `No successful master URL found for video ${videoId}`;
    console.error(`[Error] ${errMsg}`);
    return { ok: false, error: errMsg };
}

/**
 * Directly downloads VTT segments from CDN bypassing browser playback.
 */
async function downloadTranscriptDirect(
    masterUrl: string,
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
    } catch (err) {
        const error = err as Error;
        console.error(`[Direct Error] ${error}`);
        return { ok: false, error: error.message };
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
