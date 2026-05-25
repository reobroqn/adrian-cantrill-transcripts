import type { BulkState, CourseSection } from "./types";

export async function getBulkState(): Promise<BulkState | null> {
    const result = await chrome.storage.local.get(["bulk_download_state"]);
    const state = result.bulk_download_state;
    if (state && typeof state === "object" && "active" in state) {
        return state as BulkState;
    }
    return null;
}

export async function setBulkState(state: BulkState): Promise<void> {
    await chrome.storage.local.set({ bulk_download_state: state });
}

export async function removeBulkState(): Promise<void> {
    await chrome.storage.local.remove(["bulk_download_state"]);
}

export async function getCourseManifest(): Promise<CourseSection[] | null> {
    const result = await chrome.storage.local.get(["courseManifest"]);
    const manifest = result.courseManifest;
    if (Array.isArray(manifest)) {
        return manifest as CourseSection[];
    }
    return null;
}

export async function setCourseManifest(
    manifest: CourseSection[],
): Promise<void> {
    await chrome.storage.local.set({ courseManifest: manifest });
}

export async function getLastVideoId(): Promise<string | null> {
    const result = await chrome.storage.local.get(["lastCapturedVideoId"]);
    const videoId = result.lastCapturedVideoId;
    return typeof videoId === "string" ? videoId : null;
}

export async function setLastVideoId(videoId: string): Promise<void> {
    await chrome.storage.local.set({ lastCapturedVideoId: videoId });
}

export async function getMasterPlaylistUrl(
    videoId: string,
): Promise<string | null> {
    const key = `master_${videoId}`;
    const result = await chrome.storage.local.get([key]);
    const url = result[key];
    return typeof url === "string" ? url : null;
}

export async function setMasterPlaylistUrl(
    videoId: string,
    url: string,
): Promise<void> {
    await chrome.storage.local.set({
        [`master_${videoId}`]: url,
        lastCapturedVideoId: videoId,
    });
}
