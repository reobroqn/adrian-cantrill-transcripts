import {
    getBulkState,
    getCourseManifest,
    removeBulkState,
    setBulkState,
} from "../shared/storage";
import type { BulkState, ExtensionMessage, QueueItem } from "../shared/types";

const BULK_CONCURRENCY = 3;

export function broadcastMessage(msg: ExtensionMessage) {
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

/**
 * Bulk Scraper Automation Logic (Concurrent Batch)
 */
export async function startBulkDownload(sectionTitle?: string): Promise<{
    ok: boolean;
    error?: string;
}> {
    // Check if already active
    const state = await getBulkState();
    if (state?.active) {
        return { ok: false, error: "Bulk download already in progress!" };
    }

    // Get manifest
    const manifest = await getCourseManifest();
    if (!manifest || manifest.length === 0) {
        return {
            ok: false,
            error: "Please run 'Scan Course' first to build the manifest.",
        };
    }

    // Flatten lectures
    const flatQueue: QueueItem[] = [];
    for (const section of manifest) {
        if (sectionTitle && section.section_title !== sectionTitle) {
            continue;
        }
        for (const lecture of section.lectures) {
            flatQueue.push({ section: section.section_title, lecture });
        }
    }

    if (flatQueue.length === 0) {
        return { ok: false, error: "No lessons found in manifest." };
    }

    const concurrency = Math.min(BULK_CONCURRENCY, flatQueue.length);

    const newState: BulkState = {
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
            newState.tabToIndex[tab.id] = i;
        }
    }

    await setBulkState(newState);

    // Update status UI immediately
    broadcastMessage({
        type: "BULK_PROGRESS",
        payload: { completedCount: 0, total: flatQueue.length },
    });

    return { ok: true };
}

/**
 * Called when a single background tab finishes processing its lecture.
 */
async function advanceBulkWorker(tabId: number, state: BulkState) {
    state.completedCount++;

    if (state.nextIndex < state.queue.length) {
        // Claim next index and navigate this tab to it
        const claimedIndex = state.nextIndex;
        state.tabToIndex[tabId] = claimedIndex;
        state.nextIndex++;
        await setBulkState(state);

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
            await removeBulkState();
            chrome.tabs.remove(tabId).catch(() => {});
            broadcastMessage({ type: "BULK_FINISHED" });
        } else {
            await setBulkState(state);
            chrome.tabs.remove(tabId).catch(() => {});
        }
    }
}

// Listener for Tab Updates – fires for every tab including bulk background tabs
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, _tab) => {
    if (changeInfo.status !== "complete") return;

    const state = await getBulkState();
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
            {
                type: "AUTOMATION_PROCESS_LECTURE",
                index: assignedIndex,
                sectionTitle: state.queue[assignedIndex].section,
            },
            async (response) => {
                if (chrome.runtime.lastError) {
                    console.error(
                        `[Bulk Error] Tab ${tabId} – content script error:`,
                        chrome.runtime.lastError,
                    );
                    const freshState = await getBulkState();
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
                    const freshState = await getBulkState();
                    if (freshState?.active)
                        await advanceBulkWorker(tabId, freshState);
                }, 2000);
            },
        );
    }, 3000);
});

// Listener for Tab Removal – treat unexpected removal as cancellation for that worker
chrome.tabs.onRemoved.addListener(async (tabId) => {
    const state = await getBulkState();
    if (!state || !state.active) return;

    if (!(tabId in state.tabToIndex)) return; // not one of ours

    console.log(
        `[Bulk] Worker tab ${tabId} was closed externally. Cancelling bulk download.`,
    );
    await removeBulkState();
    // Also close any remaining bulk tabs
    for (const id of Object.keys(state.tabToIndex)) {
        if (Number(id) !== tabId) {
            chrome.tabs.remove(Number(id)).catch(() => {});
        }
    }
    broadcastMessage({ type: "BULK_CANCELLED" });
});
