import { Logger } from "./utils/logger";

export const config = {
    email: process.env.EMAIL || "",
    password: process.env.PASSWORD || "",
    courseId: process.env.COURSE_ID || "1820301",
    concurrency: parseInt(process.env.CONCURRENCY || "4", 10),
    session: process.env.SESSION || undefined,
    seek: process.env.SEEK === "true",
    all: process.env.ALL === "true",
    direct: process.env.DIRECT === "true",
};
/**
 * Validates that all critical configuration values are present.
 * Throws an error if any required variable is missing.
 */
export function validateConfig(): void {
    const required = ["email", "password", "courseId"];
    const missing = required.filter(
        (key) => !config[key as keyof typeof config],
    );

    if (missing.length > 0) {
        const msg = `Missing required environment variables: ${missing.join(", ")}`;
        Logger.error(msg);
        throw new Error(msg);
    }
}
