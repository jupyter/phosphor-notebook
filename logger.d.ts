// Type definitions for js-logger.js
// Project: http://github.com/jonnyreeves/js-logger

interface ILogLevel {
    value: number;
    name: string;
}

interface ILogContext {
    name: string;
    level: ILogLevel;
    filterLevel: ILogLevel;
}


interface ILogger {
  setLevel(newLevel: string): void;
  enabledFor(lvl: ILogLevel): boolean;
  debug(...args: any[]): void;
  info(...args: any[]): void;
  log(...args: any[]): void;
  warn(...args: any[]): void;
  error(...args: any[]): void;
  time(label: string): void;
  timeEnd(label: string): void;
}


interface ContextualLogger extends ILogger {
  invoke(lvl: ILogLevel, ...args: any[]): void;
  context: ILogContext;
}


interface Logger extends ILogger {
  get(name: string): ContextualLogger;
  useDefaults(lvl?: ILogLevel): void;
  setHandler(handler: (args: any[], 
                        context: ILogContext) => void): void;
  DEBUG: ILogLevel;
  INFO: ILogLevel;
  WARN: ILogLevel;
  ERROR: ILogLevel;
  TIME: ILogLevel;
  OFF: ILogLevel;
  VERSION: string;
}

declare var Logger: Logger;
