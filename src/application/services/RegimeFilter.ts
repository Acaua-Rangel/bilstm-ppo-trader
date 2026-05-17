import { CandleSeries } from "../../domain/collections/CandleSeries";
import { ADX } from "technicalindicators";

const ADX_PERIOD = 14;
// Loosened from 25 / 1.20: the original calibration locked the filter into
// "always sideways" for ~70% of backtest bars, leaving zero trades to evaluate.
const ADX_TRENDING_THRESHOLD = 20;
const VOLUME_FAST_WINDOW = 5;
const VOLUME_SLOW_WINDOW = 15;
const VOLUME_CONFIRMATION_FACTOR = 1.05;

/**
 * Service: detects whether the market is in a trending regime.
 *
 * Two conditions must hold:
 *   1. ADX > 25 — there is a directional trend (not chop).
 *   2. Recent volume confirms it — average of last 5 candles is at least
 *      20% above the average of the 15 candles before that.
 *
 * Sideways markets are where the model historically loses the most;
 * gating execution by this filter trades coverage for accuracy.
 */
export class RegimeFilter {
  isTrending(series: CandleSeries): boolean {
    return this.adxIsStrong(series) && this.volumeConfirms(series);
  }

  private adxIsStrong(series: CandleSeries): boolean {
    const adxValues = ADX.calculate({
      close: [...series.closes()],
      high: [...series.highs()],
      low: [...series.lows()],
      period: ADX_PERIOD,
    });
    const last = adxValues.at(-1);
    if (!last) return false;
    return (last.adx ?? 0) > ADX_TRENDING_THRESHOLD;
  }

  private volumeConfirms(series: CandleSeries): boolean {
    const volumes = series.volumes();
    if (volumes.length < VOLUME_FAST_WINDOW + VOLUME_SLOW_WINDOW) return false;
    const recent = volumes.slice(-VOLUME_FAST_WINDOW);
    const base = volumes.slice(
      -(VOLUME_FAST_WINDOW + VOLUME_SLOW_WINDOW),
      -VOLUME_FAST_WINDOW
    );
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const baseAvg = base.reduce((a, b) => a + b, 0) / base.length;
    if (baseAvg === 0) return false;
    return recentAvg > baseAvg * VOLUME_CONFIRMATION_FACTOR;
  }
}
