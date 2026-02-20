export interface PlayArgs {
    debug: boolean;
    session?: string;
    batchSize: number;
    concurrency: number;
    seek: boolean;
}

export interface ScrapeArgs {
    debug: boolean;
}

export function parsePlayArgs(): PlayArgs {
    const args = process.argv.slice(2);
    const debug = args.includes("--debug");
    const seek = args.includes("--seek");

    let session: string | undefined;
    const sessionIdx = args.indexOf("--session");
    if (sessionIdx !== -1) session = args[sessionIdx + 1];

    let batchSize = 10;
    const batchIdx = args.indexOf("--batch-size");
    if (batchIdx !== -1) {
        batchSize = parseInt(args[batchIdx + 1], 10);
    }

    let concurrency = 4;
    const concatIdx = args.indexOf("--concurrency") !== -1
        ? args.indexOf("--concurrency")
        : args.indexOf("-c");

    if (concatIdx !== -1) {
        concurrency = parseInt(args[concatIdx + 1], 10);
    }

    return { debug, session, batchSize, concurrency, seek };
}

export function parseScrapeArgs(): ScrapeArgs {
    const debug = process.argv.includes("--debug");
    return { debug };
}
