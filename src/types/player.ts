import type { Lecture } from "./manifest";

export interface QueueItem {
    section: string;
    lecture: Lecture;
}

export interface WorkerPoolOptions {
    concurrency: number;
    seek: boolean;
    direct?: boolean;
}

export interface ProcessOptions {
    seek: boolean;
    workerId: number;
    direct?: boolean;
}
