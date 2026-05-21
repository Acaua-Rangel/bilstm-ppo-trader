import { FeatureMatrix } from "../collections/FeatureMatrix";

/**
 * Port: forecast model (BiLSTM or other).
 * Dependency Inversion: application depends on abstraction, not on TF.js.
 */
export interface ForecastModel {
  predict(features: FeatureMatrix): Promise<ReadonlyArray<number>>;
}
