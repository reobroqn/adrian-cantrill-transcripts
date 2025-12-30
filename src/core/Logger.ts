export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
}

let currentLevel: LogLevel = LogLevel.INFO;

export const Logger = {
    setLevel(level: LogLevel) {
        currentLevel = level;
    },

    debug(message: string, ...args: unknown[]) {
        if (currentLevel <= LogLevel.DEBUG) {
            console.debug(`[DEBUG] ${message}`, ...args);
        }
    },

    info(message: string, ...args: unknown[]) {
        if (currentLevel <= LogLevel.INFO) {
            console.log(`[INFO] ${message}`, ...args);
        }
    },

    warn(message: string, ...args: unknown[]) {
        if (currentLevel <= LogLevel.WARN) {
            console.warn(`[WARN] ${message}`, ...args);
        }
    },

    error(message: string, ...args: unknown[]) {
        if (currentLevel <= LogLevel.ERROR) {
            console.error(`[ERROR] ${message}`, ...args);
        }
    },
};
