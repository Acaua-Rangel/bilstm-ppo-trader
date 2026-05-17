import { FeatureMatrix } from "../collections/FeatureMatrix";

/**
 * Port: forecast model (BiLSTM or other).
 * Dependency Inversion: application depends on abstraction, not on TF.js.
 */
export interface ForecastModel {
  predict(features: FeatureMatrix): Promise<ReadonlyArray<number>>;
  train(
    inputs: FeatureMatrix[],
    targets: number[][],
    epochs: number,
    options?: ForecastTrainOptions
  ): Promise<ForecasterTrainingState>;
}

export interface ForecastTrainOptions {
  initialState?: ForecasterTrainingState;
  onEpochEnd?: (state: ForecasterTrainingState) => Promise<void>;
}

/**
 * Snapshot of forecaster training progress.
 * Persisted in checkpoints and used to resume training from the exact epoch,
 * preserving early-stopping memory and the cosine annealing schedule.
 *
 * Note: Adam optimizer momentum is NOT preserved on resume — first epoch
 * after resume may show a small gradient instability.
 */
export interface ForecasterTrainingState {
  completedEpochs: number;
  bestValLoss: number;
  patienceCount: number;
}
