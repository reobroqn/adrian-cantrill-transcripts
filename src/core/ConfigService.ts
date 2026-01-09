import * as path from "node:path";

export class ConfigService {
    public readonly email = process.env.EMAIL || "";
    public readonly password = process.env.PASSWORD || "";
    public readonly courseId = process.env.COURSE_ID || "1820301";
    public readonly proxy = process.env.PROXY;
    public readonly projectRoot = path.join(__dirname, "..", "..");
    public readonly dataDir = path.join(this.projectRoot, "data");
    public readonly vttDir = path.join(this.dataDir, "vtt_segments");
    public readonly transcriptsDir = path.join(this.dataDir, "transcripts");
    public readonly manifestPath = path.join(
        this.dataDir,
        "course_manifest.json",
    );

    constructor() {}

    public validate(): void {
        if (!this.email || !this.password) {
            throw new Error(
                "Missing EMAIL or PASSWORD in environment variables.",
            );
        }
    }
}
