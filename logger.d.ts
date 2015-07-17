// Type definitions for js-logger.js
// Project: http://github.com/jonnyreeves/js-logger

interface ILogLevel {
    value: number;
    name: string;
}

interface ILogContext {
    name: string;
    level?: ILogLevel;
    filterLevel?: ILogLevel;
}

interface Logger {
    setLevel(newLevel: string): void;
    enabledFor(lvl: ILogLevel): boolean;
    debug(...args: any[]): void;
    info(...args: any[]): void;
    warn(...args: any[]): void;
    error(...args: any[]): void;
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


interface LoggerConstructor {
    new(context?: ILogContext): Logger;
    get(name: string): Logger;
    prototype: Logger;
}

declare var Logger: LoggerConstructor;
