import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Logger } from "./logger";

/**
 * Ensures the parent directory of `filePath` exists.
 */
export async function ensureDirectoryExists(filePath: string): Promise<void> {
    const dir = dirname(filePath);
    await mkdir(dir, { recursive: true });
}

/**
 * Writes `content` to `filePath`, creating any missing parent directories.
 */
export async function writeFileSafe(
    filePath: string,
    content: string | Buffer,
): Promise<void> {
    try {
        await ensureDirectoryExists(filePath);
        await writeFile(filePath, content, "utf-8");
    } catch (error) {
        Logger.error(`Failed to write file at ${filePath}: ${error}`);
        throw error;
    }
}

/**
 * Reads and parses a JSON file from `filePath`.
 */
export async function readJsonFile<T>(filePath: string): Promise<T> {
    try {
        const data = await readFile(filePath, "utf-8");
        return JSON.parse(data);
    } catch (error) {
        Logger.error(`Failed to read JSON at ${filePath}: ${error}`);
        throw error;
    }
}

/**
 * Stringifies and writes `data` to `filePath` as JSON.
 */
export async function writeJsonFile(
    filePath: string,
    data: unknown,
): Promise<void> {
    const content = JSON.stringify(data, null, 2);
    await writeFileSafe(filePath, content);
}

/**
 * Checks if a file or directory exists at `path`.
 */
export async function checkFileExists(targetPath: string): Promise<boolean> {
    try {
        await access(targetPath);
        return true;
    } catch {
        return false;
    }
}
