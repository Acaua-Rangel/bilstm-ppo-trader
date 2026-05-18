import { tf } from "../tensorflow/tf";
import type * as TF from "@tensorflow/tfjs-node";
import {
  ForecastModel, ForecastTrainOptions, ForecasterTrainingState, EnsembleResult,
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

    // Dense1 uses LeakyReLU instead of ReLU, and starts with a small positive
    // bias. Both changes guard against the dying-ReLU collapse the prior model
    // suffered: a ReLU layer whose biases drifted negative produced zero for
    // every input, leaving Dense2 to output only its bias as the forecast.
    const denseLinear = tf.layers.dense({
      units: hiddenUnits,
      activation: "linear",
      kernelRegularizer: reg,
      biasInitializer: tf.initializers.constant({ value: 0.01 }),
    }).apply(drop2) as TF.SymbolicTensor;
    const dense = tf.layers.leakyReLU({ alpha: 0.01 }).apply(denseLinear) as TF.SymbolicTensor;

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
   * Monte Carlo Dropout: runs `runs` forward passes with dropout kept active
   * (via `apply(x, { training: true })`) and averages. Variance across runs
   * is a proxy for predictive uncertainty: high variance → low confidence.
   *
   * Costs `runs` × inference time per call — keep `runs` between 10 and 30.
   */
  async predictWithUncertainty(
    features: FeatureMatrix, runs: number = 20
  ): Promise<EnsembleResult> {
    if (runs < 1) throw new Error("predictWithUncertainty: runs must be >= 1");
    const inputTensor = tf.tensor3d([features.toRawArray()]);
    const predictions: number[][] = [];
    try {
      for (let i = 0; i < runs; i++) {
        const output = this.model.apply(inputTensor, { training: true }) as TF.Tensor;
        const flat = Array.from(await output.data());
        tf.dispose(output);
        predictions.push(flat);
      }
    } finally {
      tf.dispose(inputTensor);
    }
    const horizon = predictions[0].length;
    const mean = new Array<number>(horizon);
    const variance = new Array<number>(horizon);
    const confidence = new Array<number>(horizon);
    for (let j = 0; j < horizon; j++) {
      let sum = 0;
      for (const p of predictions) sum += p[j];
      mean[j] = sum / runs;
      let sq = 0;
      for (const p of predictions) sq += (p[j] - mean[j]) ** 2;
      variance[j] = sq / runs;
      confidence[j] = 1 / (1 + variance[j]);
    }
    const result: EnsembleResult = { mean, variance, confidence };
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
    const validationTensors = this.buildValidationTensors(options?.validationData);
    await this.model.fit(xTensor, yTensor, {
      epochs: remainingEpochs,
      batchSize: 256,
      // When an explicit validation set is supplied (purged + embargoed by the
      // use case), use it. Otherwise fall back to the random trailing split.
      validationSplit: validationTensors === null ? 0.1 : undefined,
      validationData: validationTensors ?? undefined,
      shuffle: true,
      verbose: 1,
      callbacks: this.makeTrainingCallback(totalEpochs, state, options?.onEpochEnd),
    });
    tf.dispose([xTensor, yTensor]);
    if (validationTensors !== null) tf.dispose(validationTensors);
    return state;
  }

  private buildValidationTensors(
    validation?: { inputs: FeatureMatrix[]; targets: number[][] }
  ): [TF.Tensor3D, TF.Tensor2D] | null {
    if (!validation || validation.inputs.length === 0) return null;
    const x = tf.tensor3d(validation.inputs.map(m => m.toRawArray()));
    const y = tf.tensor2d(validation.targets);
    return [x, y];
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
