import { Money } from "../../domain/value-objects/Money";

/**
 * Service: tracks the equity baseline used by the drawdown circuit breaker.
 *
 * The original baseline was set at session inception and never moved, which
 * over a multi-week session means the "daily" drawdown limit silently
 * becomes a session-total limit. This class resets the baseline on every
 * UTC day rollover so MAX_DAILY_DRAWDOWN_PCT truly means "per day".
 *
 * UTC is chosen because exchange rate-limit windows and funding-rate cycles
 * are reported in UTC; aligning here keeps the bot's clock in sync with
 * the venue's clock.
 */
export class DailyEquityBaseline {
  private baseline: Money;
  private currentDayUtc: string;

  constructor(initialEquity: Money, now: Date) {
    this.baseline = initialEquity;
    this.currentDayUtc = DailyEquityBaseline.dayKey(now);
  }

  /**
   * Called every tick. If the UTC day has advanced, snapshot the current
   * equity as the new baseline. Returns true on rollover so callers can log.
   */
  observe(currentEquity: Money, now: Date): boolean {
    const today = DailyEquityBaseline.dayKey(now);
    if (today === this.currentDayUtc) return false;
    this.baseline = currentEquity;
    this.currentDayUtc = today;
    return true;
  }

  current(): Money {
    return this.baseline;
  }

  dayKey(): string {
    return this.currentDayUtc;
  }

  private static dayKey(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
}
