import re
from typing import Optional, Tuple
from urllib.parse import urlparse

from loguru import logger


def extract_video_id_and_filename(url: str) -> Tuple[Optional[str], Optional[str]]:
    """
    Extracts a video ID and filename from URLs like:
    https://vod-akm.play.hotmart.com/video/GZWlDBXdRA/hls/GZWlDBXdRA-1723812919000-textstream_eng=1000-70.webvtt?params...

    Returns:
        Tuple containing (video_id, filename)
        - video_id: 'GZWlDBXdRA'
        - filename: 'GZWlDBXdRA-1723812919000-textstream_eng=1000-70'
    """
    # Try to find the ID between '/video/' and '/hls/'
    match = re.search(r"/video/([^/]+)/hls/", url)
    if not match:
        logger.warning(f"Could not extract video_id using primary pattern from URL: {url}")
        return None, None

    video_id = match.group(1)
    filename = None

    # Extract the filename from the last path segment
    parsed_url = urlparse(url)
    path_segments = parsed_url.path.strip("/").split("/")

    if path_segments and path_segments[-1].endswith(".webvtt"):
        # Get the last segment and remove the .webvtt extension
        last_segment = path_segments[-1]
        filename = last_segment[:-7]  # Remove '.webvtt' extension

        # Verify the filename starts with the video_id
        if not filename.startswith(video_id):
            logger.warning(
                f"Filename '{filename}' does not start with video_id '{video_id}' in URL: {url}"
            )

    if not filename:
        logger.warning(f"Could not extract filename from URL: {url}")

    return video_id, filename
