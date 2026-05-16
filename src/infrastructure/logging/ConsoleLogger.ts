import { Logger } from "../../domain/ports/Logger";

/**
 * Adapter: console logger with timestamps.
 */
export class ConsoleLogger implements Logger {
  info(message: string, context?: Record<string, unknown>): void {
    this.log("INFO", message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log("WARN", message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log("ERROR", message, context);
  }

  private log(level: string, message: string, context?: Record<string, unknown>): void {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level}]`;
    if (context) {
      console.log(`${prefix} ${message}`, context);
      return;
    }
    console.log(`${prefix} ${message}`);
  }
}
