import * as tf from "@tensorflow/tfjs-node";
import { ForecastModel } from "../../domain/ports/ForecastModel";
import { FeatureMatrix } from "../../domain/collections/FeatureMatrix";

/**
 * Adapter: PatchTST sobre TensorFlow.js.
 * Implementa o port ForecastModel.
 */
export class PatchTSTForecaster implements ForecastModel {
  private model: tf.LayersModel;
  private readonly numPatches: number;
  private readonly config: PatchTSTConfig;

  constructor(config: PatchTSTConfig) {
    this.config = config;
    this.numPatches = Math.floor((config.seqLen - config.patchLen) / config.stride) + 1;
    this.model = this.buildModel();
  }

  private buildModel(): tf.LayersModel {
    const { patchLen, dModel, numHeads, numLayers, horizon, numFeatures, dropout } = this.config;
    const input = tf.input({ shape: [this.config.seqLen, numFeatures] });
    const posInput = tf.input({ shape: [this.numPatches] });
    let x = this.applyPatchEmbedding(input, patchLen, numFeatures, dModel);
    x = this.applyPositionalEncoding(x, posInput, dModel);
    x = this.applyEncoderBlocks(x, numLayers, numHeads, dModel, dropout);
    const output = this.applyForecastHead(x, horizon);
    return tf.model({ inputs: [input, posInput], outputs: output });
  }

  private applyPatchEmbedding(
    input: tf.SymbolicTensor, patchLen: number,
    numFeatures: number, dModel: number
  ): tf.SymbolicTensor {
    const reshaped = tf.layers.reshape({
      targetShape: [this.numPatches, patchLen * numFeatures],
    }).apply(input) as tf.SymbolicTensor;
    return tf.layers.dense({ units: dModel }).apply(reshaped) as tf.SymbolicTensor;
  }

  private applyPositionalEncoding(
    x: tf.SymbolicTensor, posInput: tf.SymbolicTensor, dModel: number
  ): tf.SymbolicTensor {
    const posEmbed = tf.layers.embedding({
      inputDim: this.numPatches, outputDim: dModel,
    }).apply(posInput) as tf.SymbolicTensor;
    return tf.layers.add().apply([x, posEmbed]) as tf.SymbolicTensor;
  }

  private applyEncoderBlocks(
    x: tf.SymbolicTensor, numLayers: number,
    numHeads: number, dModel: number, dropout: number
  ): tf.SymbolicTensor {
    let current = x;
    for (let i = 0; i < numLayers; i++) {
      current = this.applyEncoderBlock(current, numHeads, dModel, dropout, i);
    }
    return current;
  }

  private applyEncoderBlock(
    x: tf.SymbolicTensor, numHeads: number,
    dModel: number, dropout: number, layerIdx: number
  ): tf.SymbolicTensor {
    const attn = new MultiHeadSelfAttention({
      numHeads, keyDim: Math.floor(dModel / numHeads), dropout,
      name: `mhsa_${layerIdx}`,
    }).apply(x) as tf.SymbolicTensor;
    const norm1 = tf.layers.layerNormalization().apply(
      tf.layers.add().apply([x, attn]) as tf.SymbolicTensor
    ) as tf.SymbolicTensor;
    const ff = this.applyFeedForward(norm1, dModel, dropout, layerIdx);
    return tf.layers.layerNormalization().apply(
      tf.layers.add().apply([norm1, ff]) as tf.SymbolicTensor
    ) as tf.SymbolicTensor;
  }

  private applyFeedForward(
    x: tf.SymbolicTensor, dModel: number, dropout: number, layerIdx: number
  ): tf.SymbolicTensor {
    const ff1 = tf.layers.dense({
      units: dModel * 4, activation: "relu", name: `ff1_${layerIdx}`,
    }).apply(x) as tf.SymbolicTensor;
    const ff2 = tf.layers.dense({
      units: dModel, name: `ff2_${layerIdx}`,
    }).apply(ff1) as tf.SymbolicTensor;
    return tf.layers.dropout({ rate: dropout }).apply(ff2) as tf.SymbolicTensor;
  }

  private applyForecastHead(x: tf.SymbolicTensor, horizon: number): tf.SymbolicTensor {
    const flat = tf.layers.flatten().apply(x) as tf.SymbolicTensor;
    return tf.layers.dense({
      units: horizon, name: "forecast_head",
    }).apply(flat) as tf.SymbolicTensor;
  }

  async predict(features: FeatureMatrix): Promise<ReadonlyArray<number>> {
    const inputTensor = tf.tensor3d([features.toRawArray()]);
    const posTensor = this.makePositionTensor(1);
    const output = this.model.predict([inputTensor, posTensor]) as tf.Tensor;
    const result = Array.from(await output.data());
    tf.dispose([inputTensor, posTensor, output]);
    return result;
  }

  async train(inputs: FeatureMatrix[], targets: number[][], epochs: number): Promise<void> {
    this.compileIfNeeded();
    const xTensor = tf.tensor3d(inputs.map(m => m.toRawArray()));
    const yTensor = tf.tensor2d(targets);
    const posTensor = this.makePositionTensor(inputs.length);
    await this.model.fit([xTensor, posTensor], yTensor, {
      epochs, batchSize: 32, validationSplit: 0.1, verbose: 1,
    });
    tf.dispose([xTensor, yTensor, posTensor]);
  }

  private compileIfNeeded(): void {
    this.model.compile({
      optimizer: tf.train.adam(1e-4),
      loss: "meanSquaredError",
      metrics: ["mae"],
    });
  }

  private makePositionTensor(batchSize: number): tf.Tensor2D {
    const positions = Array.from({ length: this.numPatches }, (_, i) => i);
    const batched = Array(batchSize).fill(positions);
    return tf.tensor2d(batched, [batchSize, this.numPatches], "int32");
  }

  async save(path: string): Promise<void> {
    await this.model.save(`file://${path}`);
  }

  async load(path: string): Promise<void> {
    this.model = await tf.loadLayersModel(`file://${path}/model.json`);
  }
}

export interface PatchTSTConfig {
  seqLen: number;
  patchLen: number;
  stride: number;
  dModel: number;
  numHeads: number;
  numLayers: number;
  horizon: number;
  numFeatures: number;
  dropout: number;
}

class MultiHeadSelfAttention extends tf.layers.Layer {
  private readonly numHeads: number;
  private readonly keyDim: number;
  private readonly dropoutRate: number;
  private wq!: tf.layers.Layer;
  private wk!: tf.layers.Layer;
  private wv!: tf.layers.Layer;
  private wo!: tf.layers.Layer;

  constructor(config: { numHeads: number; keyDim: number; dropout: number; name?: string }) {
    super({ name: config.name });
    this.numHeads = config.numHeads;
    this.keyDim = config.keyDim;
    this.dropoutRate = config.dropout;
  }

  build(inputShape: tf.Shape | tf.Shape[]): void {
    // inputShape is an array of shapes when layer has multiple inputs; otherwise it's a flat Shape.
    const shape = (Array.isArray(inputShape[0]) ? (inputShape as tf.Shape[])[0] : inputShape) as tf.Shape;
    const inputDim = shape[shape.length - 1] as number;
    const dModel = this.numHeads * this.keyDim;

    this.wq = tf.layers.dense({ units: dModel, useBias: false, name: `${this.name}_wq` });
    this.wk = tf.layers.dense({ units: dModel, useBias: false, name: `${this.name}_wk` });
    this.wv = tf.layers.dense({ units: dModel, useBias: false, name: `${this.name}_wv` });
    this.wo = tf.layers.dense({ units: inputDim, useBias: false, name: `${this.name}_wo` });

    this.wq.build(shape);
    this.wk.build(shape);
    this.wv.build(shape);
    this.wo.build([null, dModel] as tf.Shape);

    this.trainableWeights = [
      ...this.wq.trainableWeights,
      ...this.wk.trainableWeights,
      ...this.wv.trainableWeights,
      ...this.wo.trainableWeights,
    ];

    super.build(inputShape);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  call(inputs: tf.Tensor | tf.Tensor[], kwargs: { [key: string]: any }): tf.Tensor {
    return tf.tidy(() => {
      const x = (Array.isArray(inputs) ? inputs[0] : inputs) as tf.Tensor;
      const seqLen = x.shape[1]!;
      const dModel = this.numHeads * this.keyDim;

      const q = this.wq.call(x, kwargs) as tf.Tensor;
      const k = this.wk.call(x, kwargs) as tf.Tensor;
      const v = this.wv.call(x, kwargs) as tf.Tensor;

      // [B, S, dModel] -> [B, H, S, keyDim]
      const qH = q.reshape([-1, seqLen, this.numHeads, this.keyDim]).transpose([0, 2, 1, 3]);
      const kH = k.reshape([-1, seqLen, this.numHeads, this.keyDim]).transpose([0, 2, 1, 3]);
      const vH = v.reshape([-1, seqLen, this.numHeads, this.keyDim]).transpose([0, 2, 1, 3]);

      const scale = Math.sqrt(this.keyDim);
      const attnWeights = tf.matMul(qH, kH, false, true).div(tf.scalar(scale)).softmax(-1);
      const attn = tf.matMul(attnWeights, vH);

      // [B, H, S, keyDim] -> [B, S, dModel]
      const merged = attn.transpose([0, 2, 1, 3]).reshape([-1, seqLen, dModel]);
      return this.wo.call(merged, kwargs) as tf.Tensor;
    });
  }

  computeOutputShape(inputShape: tf.Shape | tf.Shape[]): tf.Shape {
    return (Array.isArray(inputShape[0]) ? (inputShape as tf.Shape[])[0] : inputShape) as tf.Shape;
  }

  getConfig(): tf.serialization.ConfigDict {
    return {
      ...super.getConfig(),
      numHeads: this.numHeads,
      keyDim: this.keyDim,
      dropout: this.dropoutRate,
    };
  }

  static get className(): string { return 'MultiHeadSelfAttention'; }
}
