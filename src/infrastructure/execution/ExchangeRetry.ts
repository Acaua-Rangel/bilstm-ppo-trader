import { Logger } from "../../domain/ports/Logger";
import { ExchangeUnavailableError } from "../../domain/errors/DomainError";

const RATE_LIMIT_CODES = new Set([418, 429]);
const TRANSIENT_HTTP_CODES = new Set([500, 502, 503, 504]);

/**
 * Infrastructure utility: bounded exponential backoff for exchange calls.
 *
 * SRP — owns one decision: should this call be retried, and for how long
 * should we wait before trying again? Domain errors are re-thrown
 * untouched so the use case can react to them. Binance HTTP 418/429
 * (banned / rate-limited) and transient 5xx are retried; everything else
 * fails fast.
 *
 * When the retry budget is exhausted we escalate to ExchangeUnavailableError,
 * which the session loop treats as fatal — better to halt than to keep
 * retrying blindly with an open position.
 */
export class ExchangeRetry {
  constructor(
    private readonly config: ExchangeRetryConfig,
    private readonly logger: Logger
  ) {}

  async execute<T>(operationName: string, operation: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (!this.isRetryable(error)) throw error;
        if (attempt === this.config.maxAttempts) break;
        const delay = this.delayForAttempt(attempt);
        this.logger.warn(
          `${operationName} failed (attempt ${attempt}/${this.config.maxAttempts}), retrying in ${delay}ms`,
          { error: this.describe(error) }
        );
        await this.sleep(delay);
      }
    }
    throw new ExchangeUnavailableError(
      `${operationName} exhausted ${this.config.maxAttempts} attempts: ${this.describe(lastError)}`
    );
  }

  private isRetryable(error: unknown): boolean {
    const code = this.extractStatusCode(error);
    if (code !== null && RATE_LIMIT_CODES.has(code)) return true;
    if (code !== null && TRANSIENT_HTTP_CODES.has(code)) return true;
    const name = (error as { name?: string })?.name ?? "";
    if (name === "NetworkError" || name === "RequestTimeout" || name === "DDoSProtection") return true;
    return false;
  }

  // ccxt surfaces the HTTP status as `httpStatus`, `code`, or embedded in the
  // message. We sniff all three rather than depend on a particular ccxt build.
  private extractStatusCode(error: unknown): number | null {
    if (typeof error !== "object" || error === null) return null;
    const candidate = error as { httpStatus?: number; code?: number | string; message?: string };
    if (typeof candidate.httpStatus === "number") return candidate.httpStatus;
    if (typeof candidate.code === "number") return candidate.code;
    if (typeof candidate.code === "string") {
      const parsed = parseInt(candidate.code, 10);
      if (Number.isFinite(parsed)) return parsed;
    }
    const match = candidate.message?.match(/\b(418|429|5\d\d)\b/);
    return match ? parseInt(match[1], 10) : null;
  }

  private delayForAttempt(attempt: number): number {
    const exponential = this.config.baseDelayMs * Math.pow(2, attempt - 1);
    const capped = Math.min(exponential, this.config.maxDelayMs);
    const jitter = capped * 0.25 * Math.random();
    return Math.round(capped + jitter);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private describe(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
  }
}

export interface ExchangeRetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}
