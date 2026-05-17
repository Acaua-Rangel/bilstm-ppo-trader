import { tf } from "../tensorflow/tf";
import type * as TF from "@tensorflow/tfjs-node";
import {
  ForecastModel, ForecastTrainOptions, ForecasterTrainingState,
} from "../../domain/ports/ForecastModel";
import { FeatureMatrix } from "../../domain/collections/FeatureMatrix";

/**
 * Adapter: BiLSTM (Bidirectional LSTM) on top of TensorFlow.js.
 * Much more efficient than transformers when training from scratch with limited data.
 * Implements the ForecastModel port.
 */
export class BiLSTMForecaster implements ForecastModel {
  private model: TF.LayersModel;
  private readonly config: BiLSTMConfig;
  private compiled = false;

  constructor(config: BiLSTMConfig) {
    this.config = config;
    this.model = this.buildModel();
  }

  private buildModel(): TF.LayersModel {
    const { seqLen, numFeatures, hiddenUnits, dropout, horizon, l2 } = this.config;
    const reg = tf.regularizers.l2({ l2 });
    const input = tf.input({ shape: [seqLen, numFeatures] });

    const lstm1 = tf.layers.bidirectional({
      layer: tf.layers.lstm({
        units: hiddenUnits, returnSequences: true,
        kernelRegularizer: reg, recurrentRegularizer: reg,
      }) as TF.RNN,
    }).apply(input) as TF.SymbolicTensor;

    const drop1 = tf.layers.dropout({ rate: dropout }).apply(lstm1) as TF.SymbolicTensor;

    const lstm2 = tf.layers.bidirectional({
      layer: tf.layers.lstm({
        units: Math.floor(hiddenUnits / 2),
        kernelRegularizer: reg, recurrentRegularizer: reg,
      }) as TF.RNN,
    }).apply(drop1) as TF.SymbolicTensor;

    const drop2 = tf.layers.dropout({ rate: dropout }).apply(lstm2) as TF.SymbolicTensor;

    const dense = tf.layers.dense({
      units: hiddenUnits, activation: "relu", kernelRegularizer: reg,
    }).apply(drop2) as TF.SymbolicTensor;

    const output = tf.layers.dense({ units: horizon }).apply(dense) as TF.SymbolicTensor;

    return tf.model({ inputs: input, outputs: output });
  }

  async predict(features: FeatureMatrix): Promise<ReadonlyArray<number>> {
    const inputTensor = tf.tensor3d([features.toRawArray()]);
    const output = this.model.predict(inputTensor) as TF.Tensor;
    const result = Array.from(await output.data());
    tf.dispose([inputTensor, output]);
    return result;
  }

  /**
   * Batch prediction. Processes inputs in chunks to keep GPU memory bounded
   * while still saturating the device far better than batch=1 calls.
   */
  async predictBatch(features: FeatureMatrix[]): Promise<number[][]> {
    if (features.length === 0) return [];
    const CHUNK = 512;
    const horizon = this.config.horizon;
    const results: number[][] = [];
    for (let start = 0; start < features.length; start += CHUNK) {
      const slice = features.slice(start, start + CHUNK);
      const inputTensor = tf.tensor3d(slice.map(m => m.toRawArray()));
      const output = this.model.predict(inputTensor) as TF.Tensor;
      const flat = Array.from(await output.data());
      tf.dispose([inputTensor, output]);
      for (let i = 0; i < slice.length; i++) {
        results.push(flat.slice(i * horizon, (i + 1) * horizon));
      }
    }
    return results;
  }

  async train(
    inputs: FeatureMatrix[],
    targets: number[][],
    totalEpochs: number,
    options?: ForecastTrainOptions
  ): Promise<ForecasterTrainingState> {
    const state: ForecasterTrainingState = options?.initialState
      ? { ...options.initialState }
      : { completedEpochs: 0, bestValLoss: Infinity, patienceCount: 0 };

    if (state.completedEpochs >= totalEpochs) return state;

    if (!this.compiled) {
      this.model.compile({
        optimizer: tf.train.adam(this.config.learningRate),
        loss: "meanSquaredError",
        metrics: ["mae"],
      });
      this.compiled = true;
    }

    const remainingEpochs = totalEpochs - state.completedEpochs;
    const xTensor = tf.tensor3d(inputs.map(m => m.toRawArray()));
    const yTensor = tf.tensor2d(targets);
    await this.model.fit(xTensor, yTensor, {
      epochs: remainingEpochs,
      batchSize: 256,
      validationSplit: 0.1,
      shuffle: true,
      verbose: 1,
      callbacks: this.makeTrainingCallback(totalEpochs, state, options?.onEpochEnd),
    });
    tf.dispose([xTensor, yTensor]);
    return state;
  }

  // Single callback combining cosine annealing (onEpochBegin) and early stopping (onEpochEnd).
  // Uses an epoch offset so the cosine schedule and early-stopping memory survive a resume.
  private makeTrainingCallback(
    totalEpochs: number,
    state: ForecasterTrainingState,
    onEpochEnd?: (state: ForecasterTrainingState) => Promise<void>
  ): TF.CustomCallbackArgs {
    const { learningRate, minLR, earlyStoppingPatience } = this.config;
    const MIN_DELTA = 1e-4;
    const epochOffset = state.completedEpochs;
    return {
      onEpochBegin: async (localEpoch: number) => {
        const globalEpoch = localEpoch + epochOffset;
        const cosine = 0.5 * (1 + Math.cos(Math.PI * globalEpoch / totalEpochs));
        const lr = minLR + (learningRate - minLR) * cosine;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.model.optimizer as any).learningRate = lr;
      },
      onEpochEnd: async (localEpoch: number, logs?: TF.Logs) => {
        state.completedEpochs = localEpoch + epochOffset + 1;
        const valLoss = logs?.["val_loss"];
        if (typeof valLoss === "number") {
          if (valLoss < state.bestValLoss - MIN_DELTA) {
            state.bestValLoss = valLoss;
            state.patienceCount = 0;
          } else if (++state.patienceCount >= earlyStoppingPatience) {
            this.model.stopTraining = true;
          }
        }
        if (onEpochEnd) await onEpochEnd({ ...state });
      },
    };
  }

  async save(path: string): Promise<void> {
    await this.model.save(`file://${path}`);
  }

  async load(path: string): Promise<void> {
    this.model = await tf.loadLayersModel(`file://${path}/model.json`);
    // The reloaded model has no optimizer attached — recompile to make it trainable again.
    this.compiled = false;
  }
}

export interface BiLSTMConfig {
  seqLen: number;
  numFeatures: number;
  hiddenUnits: number;
  dropout: number;
  horizon: number;
  learningRate: number;
  minLR: number;
  l2: number;
  earlyStoppingPatience: number;
}
