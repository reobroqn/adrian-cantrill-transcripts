import os

from loguru import logger
from mitmproxy import http

from helpers import extract_video_id_and_filename

# Determine the project root directory (../../..) assuming this file is in fastapi/src
# Determine the project root directory (../../..) assuming this file is in fastapi/src
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA_DIR = os.path.join(PROJECT_ROOT, "data")
VTT_DIR = os.path.join(DATA_DIR, "vtt_segments")
os.makedirs(VTT_DIR, exist_ok=True)


class VTTCollector:
    """Mitmproxy addon to collect and save raw VTT segments as text files."""

    async def response(self, flow: http.HTTPFlow):
        """
        This method is called by mitmproxy for every HTTP response.

        It performs the following main steps:
        1. Checks if the response is a relevant .webvtt file (has .webvtt in URL and status code 200).
        2. Extracts both `video_id` and `filename` from the request URL.
        3. If extraction is successful, saves the raw VTT content to a text file:
           a. Creates a directory for the video_id if it doesn't exist.
           b. Uses the extracted filename from the URL (e.g., 'GZWlDBXdRA-1723812919000-textstream_eng=1000-70').
           c. Skips if the file already exists to avoid duplicates.
           d. Saves the raw VTT content to the file without any processing.
        4. Handles and logs any exceptions during the process.
        """
        request_url = flow.request.pretty_url

        if not (
            ".webvtt" in flow.request.pretty_url
            and flow.response
            and flow.response.status_code == 200
        ):
            return

        try:
            video_id, filename = extract_video_id_and_filename(request_url)
            if not video_id or not filename:
                logger.error(
                    f"Could not extract video_id or filename from URL: {request_url}. Skipping."
                )
                return

            # Create a directory for the video_id if it doesn't exist
            video_dir = os.path.join(VTT_DIR, video_id)
            os.makedirs(video_dir, exist_ok=True)

            # Use the filename if available, otherwise use video_id
            output_filename = os.path.join(video_dir, filename + ".txt")

            # Skip if the file already exists
            if os.path.exists(output_filename):
                logger.warning(f"File {output_filename} already exists. Skipping.")
                return

            # Decode the VTT content
            vtt_content_str = flow.response.content.decode("utf-8", errors="ignore")

            # Save the raw content to a file
            with open(output_filename, "w", encoding="utf-8") as f:
                f.write(vtt_content_str)

            logger.info(f"Saved raw VTT segment for video_id: {video_id} to {output_filename}")
        except Exception as e:
            logger.error(f"Error saving VTT from {request_url}: {e}", exc_info=True)


# This is how mitmproxy discovers your addon
addons = [VTTCollector()]
