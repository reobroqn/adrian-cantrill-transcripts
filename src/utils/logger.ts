export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
}

const currentLevel: LogLevel =
    process.env.LOG_LEVEL === "debug" ? LogLevel.DEBUG : LogLevel.INFO;

export const Logger = {
    debug: (msg: string) => {
        if (currentLevel <= LogLevel.DEBUG) console.debug(`[DEBUG] ${msg}`);
    },
    info: (msg: string) => {
        if (currentLevel <= LogLevel.INFO) console.info(`[INFO]  ${msg}`);
    },
    warn: (msg: string) => {
        if (currentLevel <= LogLevel.WARN) console.warn(`[WARN]  ${msg}`);
    },
    error: (msg: string) => {
        if (currentLevel <= LogLevel.ERROR) console.error(`[ERROR] ${msg}`);
    },
};
