import * as path from "node:path";

const projectRoot = path.join(__dirname, "..", "..");

export const config = {
    email: process.env.EMAIL || "",
    password: process.env.PASSWORD || "",
    courseId: process.env.COURSE_ID || "1820301",
    batchSize: parseInt(process.env.BATCH_SIZE || "10", 10),
    concurrency: parseInt(process.env.CONCURRENCY || "4", 10),
    seek: process.env.SEEK === "true",
    dataDir: path.join(projectRoot, "data"),
    vttDir: path.join(projectRoot, "data", "vtt_segments"),
    transcriptsDir: path.join(projectRoot, "data", "transcripts"),
    manifestPath: path.join(projectRoot, "data", "course_manifest.json"),
};
