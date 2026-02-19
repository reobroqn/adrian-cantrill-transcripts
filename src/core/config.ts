import * as path from "node:path";

const projectRoot = path.join(__dirname, "..", "..");

export const config = {
    email: process.env.EMAIL || "",
    password: process.env.PASSWORD || "",
    courseId: process.env.COURSE_ID || "1820301",
    dataDir: path.join(projectRoot, "data"),
    vttDir: path.join(projectRoot, "data", "vtt_segments"),
    transcriptsDir: path.join(projectRoot, "data", "transcripts"),
    manifestPath: path.join(projectRoot, "data", "course_manifest.json"),
};

export function validateConfig(): void {
    if (!config.email || !config.password) {
        throw new Error("Missing EMAIL or PASSWORD in environment variables.");
    }
}
