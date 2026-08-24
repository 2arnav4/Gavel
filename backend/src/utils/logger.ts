import { env } from "../config/env.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogContext = Record<string, unknown>;

export type Logger = {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
};

type LoggerOptions = {
  level?: LogLevel;
  json?: boolean;
  sink?: (line: string) => void;
  now?: () => Date;
};

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];

function isLogLevel(value: string): value is LogLevel {
  return (LEVELS as string[]).includes(value);
}

function serializeError(error: Error): LogContext {
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
}

export function serializeContext(context: LogContext): LogContext {
  const output: LogContext = {};

  for (const [key, value] of Object.entries(context)) {
    output[key] = value instanceof Error ? serializeError(value) : value;
  }

  return output;
}

function formatHuman(timestamp: string, level: LogLevel, message: string, context: LogContext): string {
  const keys = Object.keys(context);
  const suffix = keys.length === 0 ? "" : ` ${JSON.stringify(context)}`;
  return `${timestamp} ${level.toUpperCase().padEnd(5)} ${message}${suffix}`;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const configured = process.env.LOG_LEVEL ?? "";
  const level = options.level
    ?? (isLogLevel(configured) ? configured : undefined)
    ?? (env.isDevelopment ? "debug" : "info");
  const json = options.json ?? !env.isDevelopment;
  const sink = options.sink ?? ((line: string) => process.stdout.write(`${line}\n`));
  const now = options.now ?? (() => new Date());

  const threshold = LEVEL_RANK[level];

  function write(entryLevel: LogLevel, message: string, context?: LogContext): void {
    if (LEVEL_RANK[entryLevel] < threshold) return;

    const timestamp = now().toISOString();
    const payload = serializeContext(context ?? {});

    sink(
      json
        ? JSON.stringify({ timestamp, level: entryLevel, message, ...payload })
        : formatHuman(timestamp, entryLevel, message, payload),
    );
  }

  return {
    debug: (message, context) => write("debug", message, context),
    info: (message, context) => write("info", message, context),
    warn: (message, context) => write("warn", message, context),
    error: (message, context) => write("error", message, context),
  };
}

export const logger = createLogger();
