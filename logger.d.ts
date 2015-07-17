// Type definitions for js-logger.js
// Project: http://github.com/jonnyreeves/js-logger


declare module "logger" {

export
interface ILogLevel {
    value: number;
    name: string;
}

export
interface ILogContext {
    name: string;
    level: ILogLevel;
    filterLevel: ILogLevel;
}

export
interface Logger {
    setLevel(newLevel: string): void;
    enabledFor(lvl: ILogLevel): boolean;
    get(name: string): Logger;
    debug(): void;
    info(): void;
    warn(): void;
    error(): void;
    time(label: string): void;
    timeEnd(label: string): void;
    invoke(lvl: ILogLevel, ...args: any[]): void;
    useDefaults(lvl?: ILogLevel): void;
    setHandler(handler: (args: any[], 
                          context: ILogContext) => void): void;
    DEBUG: ILogLevel;
    INFO: ILogLevel;
    WARN: ILogLevel;
    ERROR: ILogLevel;
    TIME: ILogLevel;
    OFF: ILogLevel;
}

} // module logger
