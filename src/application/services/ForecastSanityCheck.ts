import { CandleSeries } from "../../domain/collections/CandleSeries";
import { ForecastModel } from "../../domain/ports/ForecastModel";
import { Logger } from "../../domain/ports/Logger";
import { FeatureBuilder } from "./FeatureBuilder";
import { SIGNAL_HORIZON_INDEX } from "./TradingCycle";

const MIN_INDICATOR_WARMUP = 100;
const ACTUAL_HORIZON_BARS = SIGNAL_HORIZON_INDEX + 1;

/**
 * Service: pre-session diagnostic that logs the forecaster's output
 * distribution and directional accuracy against the most recent candles.
 *
 * A model that collapsed to a constant (e.g., 0.5 across every bar)
 * shows up as predStd ≈ 0 versus a healthy actualStd ≈ 0.005+. The user
 * can then decide whether to abort or proceed.
 *
 * Replaces the former CalibrationWarmup — now that no probability gate
 * remains in the trading cycle, fitting a Platt calibrator was wasted
 * work, but the sanity log is still valuable.
 */
export class ForecastSanityCheck {
  async run(input: SanityCheckInput): Promise<void> {
    const { series, forecaster, featureBuilder, logger, samples } = input;
    const size = series.size();
    const lastIndex = size - 1 - ACTUAL_HORIZON_BARS;
    const minWarmup = Math.max(MIN_INDICATOR_WARMUP, featureBuilder.getWindowSize() - 1);
    const firstIndex = Math.max(minWarmup, lastIndex - samples + 1);
    if (firstIndex > lastIndex) {
      logger.warn("ForecastSanityCheck skipped: insufficient candles", {
        size, samples, minRequired: minWarmup + samples + ACTUAL_HORIZON_BARS,
      });
      return;
    }
    const predictions: number[] = [];
    const actuals: number[] = [];
    for (let t = firstIndex; t <= lastIndex; t++) {
      const window = series.rangeFromIndex(0, t + 1);
      const features = featureBuilder.build(window);
      const forecast = await forecaster.predict(features);
      const currentClose = series.at(t).closePrice().toNumber();
      const futureClose = series.at(t + ACTUAL_HORIZON_BARS).closePrice().toNumber();
      predictions.push(forecast[SIGNAL_HORIZON_INDEX]);
      actuals.push(futureClose > currentClose ? 1 : 0);
    }
    this.logSanityCheck(predictions, actuals, logger);
  }

  private logSanityCheck(predictions: number[], actuals: number[], logger: Logger): void {
    const predMean = mean(predictions);
    const predStd = std(predictions, predMean);
    const actualMean = mean(actuals);
    const hits = predictions.reduce(
      (acc, p, idx) => acc + ((p > 0.5 ? 1 : 0) === actuals[idx] ? 1 : 0),
      0
    );
    const directionalAcc = predictions.length > 0 ? hits / predictions.length : 0;
    const degenerate = predStd < 1e-4;
    logger.info("Forecaster sanity check (classification)", {
      samples: predictions.length,
      predMean: predMean.toFixed(3),
      predStd: predStd.toFixed(3),
      actualUpRate: actualMean.toFixed(3),
      directionalAccuracy: (directionalAcc * 100).toFixed(2) + "%",
    });
    if (degenerate) {
      logger.warn(
        "Forecaster output is nearly constant — model may have collapsed. " +
        "Trading will proceed but the PPO will be acting on a near-flat signal."
      );
    }
  }
}

export interface SanityCheckInput {
  series: CandleSeries;
  forecaster: ForecastModel;
  featureBuilder: FeatureBuilder;
  logger: Logger;
  samples: number;
}

function mean(values: ReadonlyArray<number>): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function std(values: ReadonlyArray<number>, average: number): number {
  if (values.length === 0) return 0;
  let sq = 0;
  for (const v of values) sq += (v - average) ** 2;
  return Math.sqrt(sq / values.length);
}
