export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
}

export interface ILogger {
    setLevel(level: LogLevel): void;
    debug(message: string, ...args: unknown[]): void;
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
}

export class ConsoleLogger implements ILogger {
    private currentLevel: LogLevel = LogLevel.INFO;

    setLevel(level: LogLevel) {
        this.currentLevel = level;
    }

    debug(message: string, ...args: unknown[]) {
        if (this.currentLevel <= LogLevel.DEBUG) {
            console.debug(`[DEBUG] ${message}`, ...args);
        }
    }

    info(message: string, ...args: unknown[]) {
        if (this.currentLevel <= LogLevel.INFO) {
            console.log(`[INFO] ${message}`, ...args);
        }
    }

    warn(message: string, ...args: unknown[]) {
        if (this.currentLevel <= LogLevel.WARN) {
            console.warn(`[WARN] ${message}`, ...args);
        }
    }

    error(message: string, ...args: unknown[]) {
        if (this.currentLevel <= LogLevel.ERROR) {
            console.error(`[ERROR] ${message}`, ...args);
        }
    }
}
