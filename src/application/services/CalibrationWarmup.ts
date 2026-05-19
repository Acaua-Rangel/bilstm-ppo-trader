import { CandleSeries } from "../../domain/collections/CandleSeries";
import { ForecastModel } from "../../domain/ports/ForecastModel";
import { Logger } from "../../domain/ports/Logger";
import { FeatureBuilder } from "./FeatureBuilder";
import { PlattCalibrator } from "./PlattCalibrator";

const MIN_INDICATOR_WARMUP = 100;

/**
 * Service: one-shot warm-up before a trading session.
 *
 * Two responsibilities, both intentionally bundled because they share the
 * same forward-pass cost:
 *
 *   1. Sanity check: logs mean/std of forecaster output vs the actual return
 *      distribution over the warm-up window. A model that collapsed to a
 *      constant (e.g., 0.00048 across all bars in the prior backtest) shows
 *      up immediately as `predStd ≈ 0` versus a healthy `actualStd ≈ 0.005+`.
 *
 *   2. Platt fit: feeds the same (prediction, realized return) pairs into
 *      the calibrator so its slope/intercept reflect this dataset instead
 *      of the identity-sigmoid default.
 *
 * The caller is responsible for ensuring the calibration window is disjoint
 * from the data the session will trade on — otherwise the calibrator gates
 * trades using information from the future being tested.
 */
export class CalibrationWarmup {
  async run(input: WarmupInput): Promise<void> {
    const { series, forecaster, featureBuilder, calibrator, logger, samples } = input;
    const size = series.size();
    const lastIndex = size - 2; // need t+1 for actual return
    // Window must contain at least featureBuilder.getWindowSize() candles —
    // otherwise FeatureMatrix is smaller than the model's input shape.
    const minWarmup = Math.max(MIN_INDICATOR_WARMUP, featureBuilder.getWindowSize() - 1);
    const firstIndex = Math.max(minWarmup, lastIndex - samples + 1);
    if (firstIndex > lastIndex) {
      logger.warn("CalibrationWarmup skipped: insufficient candles", {
        size, samples, minRequired: minWarmup + samples + 1,
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
      const nextClose = series.at(t + 1).closePrice().toNumber();
      predictions.push(forecast[0]);
      actuals.push((nextClose - currentClose) / currentClose);
    }
    this.logSanityCheck(predictions, actuals, logger);
    calibrator.calibrate(predictions, actuals);
    const params = calibrator.parameters();
    logger.info("Platt calibration completed", {
      samples: predictions.length,
      slope: params.slope.toFixed(4),
      intercept: params.intercept.toFixed(4),
    });
  }

  private logSanityCheck(predictions: number[], actuals: number[], logger: Logger): void {
    const predMean = mean(predictions);
    const predStd = std(predictions, predMean);
    const actualMean = mean(actuals);
    const actualStd = std(actuals, actualMean);
    const scale = predStd > 0 ? actualStd / predStd : 0;
    const degenerate = predStd < 1e-6;
    logger.info("Forecaster sanity check", {
      samples: predictions.length,
      predMean: predMean.toExponential(2),
      predStd: predStd.toExponential(2),
      actualMean: actualMean.toExponential(2),
      actualStd: actualStd.toExponential(2),
      scaleRatio: scale.toFixed(2),
    });
    if (degenerate) {
      logger.warn(
        "Forecaster output is nearly constant — model may have collapsed. " +
        "Calibration will still run but trades will rely on the regime/threshold filters."
      );
    }
  }
}

export interface WarmupInput {
  series: CandleSeries;
  forecaster: ForecastModel;
  featureBuilder: FeatureBuilder;
  calibrator: PlattCalibrator;
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
