import { CandleSeries } from "../../domain/collections/CandleSeries";
import { ATR } from "technicalindicators";

const FAST_PERIOD = 14;
const SLOW_PERIOD = 50;

/**
 * Service: scales a base signal threshold by the recent-to-historical
 * volatility ratio (ATR14 / ATR50).
 *
 * In a high-volatility regime, a 0.2% expected return is noise; in a
 * quiet regime, the same value is a real signal. By multiplying the
 * base threshold by the ratio, the bot demands stronger signals when
 * the market is jumpy.
 */
export class AdaptiveThreshold {
  compute(series: CandleSeries, baseThreshold: number): number {
    const ratio = this.volatilityRatio(series);
    if (ratio <= 0) return baseThreshold;
    return baseThreshold * ratio;
  }

  private volatilityRatio(series: CandleSeries): number {
    const fast = this.atr(series, FAST_PERIOD);
    const slow = this.atr(series, SLOW_PERIOD);
    if (slow === 0) return 1;
    return fast / slow;
  }

  private atr(series: CandleSeries, period: number): number {
    const values = ATR.calculate({
      high: [...series.highs()],
      low: [...series.lows()],
      close: [...series.closes()],
      period,
    });
    return values.at(-1) ?? 0;
  }
}
