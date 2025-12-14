#!/usr/bin/env python3
"""
Make Transcripts Script

This script processes VTT segment files and creates complete transcripts.
It scans the vtt_segments directory for all segments belonging to each video ID,
parses each segment to extract content, sorts them chronologically,
removes duplicates, concatenates incomplete sentences, and saves the complete transcript.
"""

import glob
import os
import re
from dataclasses import dataclass
from typing import List, Optional

from loguru import logger


@dataclass(frozen=True, eq=True)
class VTTSegment:
    """Represents a single segment of text from a VTT file."""

    time_range: str  # e.g., "00:00:12.000 --> 00:00:12.320"
    content: str  # The actual text content
    content_id: Optional[str] = None  # Optional numeric ID from the VTT file

    def __post_init__(self):
        # Ensure content is stripped to avoid issues with leading/trailing whitespace in comparisons
        object.__setattr__(self, "content", self.content.strip())

    @property
    def start_time_ms(self) -> int:
        """Converts the start time of the time_range to milliseconds."""
        match = re.match(r"(\d{2}):(\d{2}):(\d{2})\.(\d{3})", self.time_range.split(" --> ")[0])
        if match:
            h, m, s, ms = map(int, match.groups())
            return (h * 3600 + m * 60 + s) * 1000 + ms
        logger.warning(f"Could not parse start time from time_range: {self.time_range}")
        return 0  # Should not happen with valid VTT


class TranscriptMaker:
    """Class to process VTT segments and create complete transcripts."""

    def __init__(self, segments_dir: str = "vtt_segments", output_dir: str = "transcripts"):
        self.segments_dir = segments_dir
        self.output_dir = output_dir

        # Ensure the output directory exists
        os.makedirs(self.output_dir, exist_ok=True)

        # Set of processed content to avoid duplicates
        self.processed_content = set()

    def get_video_ids(self) -> List[str]:
        """Get a list of all video IDs in the segments directory."""
        if not os.path.exists(self.segments_dir):
            logger.error(f"Segments directory {self.segments_dir} does not exist.")
            return []

        # List all subdirectories in the segments directory
        return [
            d
            for d in os.listdir(self.segments_dir)
            if os.path.isdir(os.path.join(self.segments_dir, d))
        ]

    def parse_vtt_file(self, file_path: str) -> List[VTTSegment]:
        """Parse a VTT file and extract segments."""
        segments = []

        try:
            with open(file_path, "r", encoding="utf-8") as f:
                content = f.read()
        except Exception as e:
            logger.error(f"Error reading file {file_path}: {e}")
            return []

        # Split the content into lines
        lines = content.strip().splitlines()

        # Check for WEBVTT header, but don't fail if missing
        if not lines or not lines[0].strip().startswith("WEBVTT"):
            logger.warning(f"File {file_path} does not start with WEBVTT header or is empty.")

        current_block_lines = []
        for line in lines:
            line = line.strip()

            # Skip headers and notes
            if (
                line.startswith("WEBVTT")
                or line.startswith("X-TIMESTAMP-MAP")
                or line.startswith("NOTE")
                or line.startswith("Kind:")
                or line.startswith("Language:")
            ):
                continue

            # Empty line signifies the end of a cue block
            if not line:
                if current_block_lines:
                    segment = self.parse_vtt_block(current_block_lines)
                    if segment:
                        segments.append(segment)
                    current_block_lines = []
                continue

            current_block_lines.append(line)

        # Process any remaining block
        if current_block_lines:
            segment = self.parse_vtt_block(current_block_lines)
            if segment:
                segments.append(segment)

        return segments

    def parse_vtt_block(self, lines: List[str]) -> Optional[VTTSegment]:
        """Parse a single VTT block into a VTTSegment."""
        if not lines:
            return None

        content_id = None
        time_range = None
        content_lines = []

        # Find the time range line (contains "-->")
        time_range_index = -1
        for i, line in enumerate(lines):
            if "-->" in line:
                time_range = line
                time_range_index = i
                break

        if time_range is None:
            logger.debug(f"No time_range ('-->') found in segment: {lines}. Skipping.")
            return None

        # Check for content_id (if there's a line before time_range and it's numeric)
        if time_range_index > 0:
            potential_id = lines[0]
            if potential_id.isdigit():  # Simple check for common numeric IDs
                content_id = potential_id

        # Everything after the time range is content
        content_lines = lines[time_range_index + 1 :]
        full_content = " ".join(content_lines).strip()

        return VTTSegment(time_range=time_range, content=full_content, content_id=content_id)

    def process_video(self, video_id: str) -> bool:
        """Process all segments for a video ID and create a complete transcript."""
        video_dir = os.path.join(self.segments_dir, video_id)
        if not os.path.exists(video_dir):
            logger.error(f"No segments directory found for video ID: {video_id}")
            return False

        # Get all segment files for this video ID
        segment_files = glob.glob(os.path.join(video_dir, "*.txt"))
        if not segment_files:
            logger.warning(f"No segment files found for video ID: {video_id}")
            return False

        logger.info(f"Found {len(segment_files)} segment files for video ID: {video_id}")

        # Parse all segments
        all_segments = []
        for file_path in segment_files:
            segments = self.parse_vtt_file(file_path)
            all_segments.extend(segments)

        if not all_segments:
            logger.warning(f"No valid segments parsed for video ID: {video_id}")
            return False

        # Sort segments by start time
        all_segments.sort(key=lambda s: s.start_time_ms)

        # Process segments to remove duplicates and concatenate incomplete sentences
        processed_text = self.process_segments(all_segments)

        # Save the transcript to a file
        output_file = os.path.join(self.output_dir, f"{video_id}.txt")
        with open(output_file, "w", encoding="utf-8") as f:
            f.write(processed_text)

        logger.info(f"Transcript for {video_id} saved to {output_file}")
        return True

    def process_segments(self, segments: List[VTTSegment]) -> str:
        """Process segments to remove duplicates and concatenate incomplete sentences."""
        # Reset processed content for this video
        self.processed_content = set()

        result = []
        current_sentence = ""

        for segment in segments:
            # Skip if content is empty
            if not segment.content.strip():
                continue

            # Skip if this exact content has been seen before
            if segment.content in self.processed_content:
                continue

            self.processed_content.add(segment.content)

            # Check if this segment starts with lowercase 
            # or doesn't end with sentence-ending punctuation
            content = segment.content

            # If current_sentence is not empty, we're in the middle of building a sentence
            if current_sentence:
                # If this segment starts with uppercase and previous didn't end with punctuation,
                # it might be a new sentence
                if content[0].isupper() and current_sentence.rstrip()[-1] not in [
                    ".",
                    "!",
                    "?",
                    ":",
                    ";",
                ]:
                    # But check if it's a continuation by common words that can start sentences
                    continuation_words = ["And", "But", "Or", "So", "Then", "However", "Therefore"]
                    is_continuation = any(
                        content.startswith(word + " ") for word in continuation_words
                    )

                    if is_continuation:
                        current_sentence += " " + content
                    else:
                        # It's a new sentence, add the current one to results
                        result.append(current_sentence)
                        current_sentence = content
                else:
                    # It's a continuation of the current sentence
                    current_sentence += " " + content
            else:
                # Starting a new sentence
                current_sentence = content

            # If the current sentence ends with sentence-ending punctuation, add it to results
            if current_sentence.rstrip()[-1] in [".", "!", "?"]:
                result.append(current_sentence)
                current_sentence = ""

        # Add any remaining sentence
        if current_sentence:
            result.append(current_sentence)

        return "\n\n".join(result)

    def process_all_videos(self) -> int:
        """Process all videos in the segments directory."""
        video_ids = self.get_video_ids()
        if not video_ids:
            logger.error("No video IDs found in segments directory")
            return 1

        success_count = 0
        for video_id in video_ids:
            if self.process_video(video_id):
                success_count += 1

        logger.info(f"Successfully processed {success_count} out of {len(video_ids)} videos")
        return 0 if success_count == len(video_ids) else 1


def main():
    """Main function to run the transcript maker."""
    maker = TranscriptMaker()
    return maker.process_all_videos()


if __name__ == "__main__":
    exit(main())
