import * as tf from "@tensorflow/tfjs-node";
import { ForecastModel } from "../../domain/ports/ForecastModel";
import { FeatureMatrix } from "../../domain/collections/FeatureMatrix";

/**
 * Adapter: BiLSTM (Bidirectional LSTM) on top of TensorFlow.js.
 * Much more efficient than transformers when training from scratch with limited data.
 * Implements the ForecastModel port.
 */
export class BiLSTMForecaster implements ForecastModel {
  private model: tf.LayersModel;
  private readonly config: BiLSTMConfig;
  private compiled = false;

  constructor(config: BiLSTMConfig) {
    this.config = config;
    this.model = this.buildModel();
  }

  private buildModel(): tf.LayersModel {
    const { seqLen, numFeatures, hiddenUnits, dropout, horizon, l2 } = this.config;
    const reg = tf.regularizers.l2({ l2 });
    const input = tf.input({ shape: [seqLen, numFeatures] });

    const lstm1 = tf.layers.bidirectional({
      layer: tf.layers.lstm({
        units: hiddenUnits, returnSequences: true,
        kernelRegularizer: reg, recurrentRegularizer: reg,
      }) as tf.RNN,
    }).apply(input) as tf.SymbolicTensor;

    const drop1 = tf.layers.dropout({ rate: dropout }).apply(lstm1) as tf.SymbolicTensor;

    const lstm2 = tf.layers.bidirectional({
      layer: tf.layers.lstm({
        units: Math.floor(hiddenUnits / 2),
        kernelRegularizer: reg, recurrentRegularizer: reg,
      }) as tf.RNN,
    }).apply(drop1) as tf.SymbolicTensor;

    const drop2 = tf.layers.dropout({ rate: dropout }).apply(lstm2) as tf.SymbolicTensor;

    const dense = tf.layers.dense({
      units: hiddenUnits, activation: "relu", kernelRegularizer: reg,
    }).apply(drop2) as tf.SymbolicTensor;

    const output = tf.layers.dense({ units: horizon }).apply(dense) as tf.SymbolicTensor;

    return tf.model({ inputs: input, outputs: output });
  }

  async predict(features: FeatureMatrix): Promise<ReadonlyArray<number>> {
    const inputTensor = tf.tensor3d([features.toRawArray()]);
    const output = this.model.predict(inputTensor) as tf.Tensor;
    const result = Array.from(await output.data());
    tf.dispose([inputTensor, output]);
    return result;
  }

  async train(inputs: FeatureMatrix[], targets: number[][], epochs: number): Promise<void> {
    if (!this.compiled) {
      this.model.compile({
        optimizer: tf.train.adam(this.config.learningRate),
        loss: "meanSquaredError",
        metrics: ["mae"],
      });
      this.compiled = true;
    }
    const xTensor = tf.tensor3d(inputs.map(m => m.toRawArray()));
    const yTensor = tf.tensor2d(targets);
    await this.model.fit(xTensor, yTensor, {
      epochs,
      batchSize: 32,
      validationSplit: 0.1,
      shuffle: true,
      verbose: 1,
      callbacks: this.makeTrainingCallback(epochs),
    });
    tf.dispose([xTensor, yTensor]);
  }

  // Single callback combining cosine annealing (onEpochBegin) and early stopping (onEpochEnd).
  // Before: mixing plain object + EarlyStopping instance caused tfjs to wrap them in
  // CustomCallback, breaking `this.getMonitorValue is not a function`.
  private makeTrainingCallback(totalEpochs: number): tf.CustomCallbackArgs {
    const { learningRate, minLR, earlyStoppingPatience } = this.config;
    const MIN_DELTA = 1e-4;
    let bestValLoss = Infinity;
    let patienceCount = 0;
    return {
      onEpochBegin: async (epoch: number) => {
        const cosine = 0.5 * (1 + Math.cos(Math.PI * epoch / totalEpochs));
        const lr = minLR + (learningRate - minLR) * cosine;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.model.optimizer as any).learningRate = lr;
      },
      onEpochEnd: async (_epoch: number, logs?: tf.Logs) => {
        const valLoss = logs?.["val_loss"];
        if (typeof valLoss !== "number") return;
        if (valLoss < bestValLoss - MIN_DELTA) {
          bestValLoss = valLoss;
          patienceCount = 0;
        } else if (++patienceCount >= earlyStoppingPatience) {
          this.model.stopTraining = true;
        }
      },
    };
  }

  async save(path: string): Promise<void> {
    await this.model.save(`file://${path}`);
  }

  async load(path: string): Promise<void> {
    this.model = await tf.loadLayersModel(`file://${path}/model.json`);
    this.compiled = true;
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
