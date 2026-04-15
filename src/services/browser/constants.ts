import { join } from "node:path";

/**
 * Project-wide path constants.
 * These are based on the project root directory.
 */
const projectRoot = join(__dirname, "..", "..", "..");

export const DATA_DIR = join(projectRoot, "data");
export const VTT_DIR = join(projectRoot, "data", "vtt_segments");
export const TRANSCRIPTS_DIR = join(projectRoot, "data", "transcripts");
export const MANIFEST_PATH = join(projectRoot, "data", "course_manifest.json");

export const LOGIN_URL =
    "https://sso.teachable.com/secure/212820/identity/login/password?force=true";
