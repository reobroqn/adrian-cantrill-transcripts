export interface PlayArgs {
    debug: boolean;
    session?: string;
    batchSize: number;
}

export interface ScrapeArgs {
    debug: boolean;
}

export function parsePlayArgs(): PlayArgs {
    const args = process.argv.slice(2);
    const debug = args.includes("--debug");

    let session: string | undefined;
    const sessionIdx = args.indexOf("--session");
    if (sessionIdx !== -1) session = args[sessionIdx + 1];

    let batchSize = 1;
    const batchIdx = args.indexOf("--batch-size");
    if (batchIdx !== -1) batchSize = parseInt(args[batchIdx + 1], 10);

    return { debug, session, batchSize };
}

export function parseScrapeArgs(): ScrapeArgs {
    const debug = process.argv.includes("--debug");
    return { debug };
}

export interface ConvertArgs {
    debug: boolean;
    /** Convert only this specific video ID folder */
    id?: string;
    /** Overwrite existing transcript files */
    force: boolean;
}

export function parseConvertArgs(): ConvertArgs {
    const args = process.argv.slice(2);
    const debug = args.includes("--debug");
    const force = args.includes("--force");

    let id: string | undefined;
    const idIdx = args.indexOf("--id");
    if (idIdx !== -1) id = args[idIdx + 1];

    return { debug, id, force };
}
