/**
 * URL parsing utilities for extracting video IDs and filenames from VTT URLs
 */

export interface VideoIdAndFilename {
    videoId: string | null;
    filename: string | null;
}

/**
 * Extracts a video ID and filename from URLs like:
 * https://vod-akm.play.hotmart.com/video/GZWlDBXdRA/hls/GZWlDBXdRA-1723812919000-textstream_eng=1000-70.webvtt?params...
 *
 * @param url - The URL to parse
 * @returns Object containing videoId and filename
 */
export function extractVideoIdAndFilename(url: string): VideoIdAndFilename {
    // Try to find the ID between '/video/' and '/hls/'
    const videoMatch = url.match(/\/video\/([^/]+)\/hls\//);

    if (!videoMatch) {
        console.warn(
            `Could not extract video_id using primary pattern from URL: ${url}`,
        );
        return { videoId: null, filename: null };
    }

    const videoId = videoMatch[1];
    let filename: string | null = null;

    try {
        // Extract the filename from the last path segment
        const urlObj = new URL(url);
        const pathSegments = urlObj.pathname
            .split("/")
            .filter((s) => s.length > 0);

        if (
            pathSegments.length > 0 &&
            pathSegments[pathSegments.length - 1].endsWith(".webvtt")
        ) {
            // Get the last segment and remove the .webvtt extension
            const lastSegment = pathSegments[pathSegments.length - 1];
            filename = lastSegment.slice(0, -7); // Remove '.webvtt'

            // Verify the filename starts with the video_id
            if (!filename.startsWith(videoId)) {
                console.warn(
                    `Filename '${filename}' does not start with video_id '${videoId}' in URL: ${url}`,
                );
            }
        }

        if (!filename) {
            console.warn(`Could not extract filename from URL: ${url}`);
        }
    } catch (error) {
        console.error(`Error parsing URL: ${error}`);
    }

    return { videoId, filename };
}
