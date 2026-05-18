import { FeatureMatrix } from "../collections/FeatureMatrix";

/**
 * Port: forecast model (BiLSTM or other).
 * Dependency Inversion: application depends on abstraction, not on TF.js.
 */
export interface ForecastModel {
  predict(features: FeatureMatrix): Promise<ReadonlyArray<number>>;
  /**
   * Monte Carlo Dropout ensemble: runs `runs` forward passes with dropout
   * active and reports mean, variance and a 1/(1+variance) confidence.
   * Used at inference to gate low-confidence trades without retraining.
   */
  predictWithUncertainty(features: FeatureMatrix, runs?: number): Promise<EnsembleResult>;
}

export interface EnsembleResult {
  mean: ReadonlyArray<number>;
  variance: ReadonlyArray<number>;
  confidence: ReadonlyArray<number>;
}
