export interface PlayArgs {
    debug: boolean;
    session?: string;
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

    return { debug, session };
}

export function parseScrapeArgs(): ScrapeArgs {
    const debug = process.argv.includes("--debug");
    return { debug };
}
