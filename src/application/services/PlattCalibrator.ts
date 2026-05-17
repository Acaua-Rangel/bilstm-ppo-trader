/**
 * Service: Platt scaling — converts a raw forecast value into a calibrated
 * probability via logistic regression p = σ(slope · pred + intercept).
 *
 * Defaults (slope=1, intercept=0) act as identity-sigmoid, which is safe
 * to use before any calibration has been performed. Call `calibrate()`
 * with historical predictions and realized returns to fit the parameters.
 */
export class PlattCalibrator {
  private slope: number;
  private intercept: number;
  private calibrated: boolean;

  constructor(slope: number = 1.0, intercept: number = 0.0) {
    this.slope = slope;
    this.intercept = intercept;
    this.calibrated = false;
  }

  calibrate(predictions: number[], actualReturns: number[]): void {
    if (predictions.length !== actualReturns.length) {
      throw new Error("PlattCalibrator: arrays must have equal length");
    }
    if (predictions.length === 0) return;
    const ITERATIONS = 1000;
    const LR = 0.01;
    const n = predictions.length;
    for (let iter = 0; iter < ITERATIONS; iter++) {
      let gradSlope = 0;
      let gradIntercept = 0;
      for (let i = 0; i < n; i++) {
        const logit = this.slope * predictions[i] + this.intercept;
        const prob = this.sigmoid(logit);
        const label = actualReturns[i] > 0 ? 1 : 0;
        const err = prob - label;
        gradSlope += err * predictions[i];
        gradIntercept += err;
      }
      this.slope -= LR * gradSlope / n;
      this.intercept -= LR * gradIntercept / n;
    }
    this.calibrated = true;
  }

  isCalibrated(): boolean {
    return this.calibrated;
  }

  calibratedProbability(rawPrediction: number): number {
    return this.sigmoid(this.slope * rawPrediction + this.intercept);
  }

  parameters(): CalibratorParameters {
    return { slope: this.slope, intercept: this.intercept };
  }

  private sigmoid(x: number): number {
    return 1 / (1 + Math.exp(-x));
  }
}

export interface CalibratorParameters {
  slope: number;
  intercept: number;
}
