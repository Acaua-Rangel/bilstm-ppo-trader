import { tf } from "../tensorflow/tf";
import type * as TF from "@tensorflow/tfjs-node";

/**
 * Custom tf.js layer: scaled dot-product self-attention.
 *
 * Sits on top of the second BiLSTM (which now returns sequences) and
 * lets the forecaster weight time-steps according to their relevance to
 * each other instead of relying solely on the last hidden state.
 *
 *   Q = X · Wq        [B, T, D]
 *   K = X · Wk        [B, T, D]
 *   V = X · Wv        [B, T, D]
 *   scores  = Q · Kᵀ / √D                    [B, T, T]
 *   weights = softmax(scores, axis=-1)        [B, T, T]
 *   output  = weights · V                     [B, T, D]
 *
 * Single-head by design: the BiLSTM already mixes channels, and
 * multi-head + Bi-RNN on hourly crypto data tends to overfit
 * (verified in our own runs and in Lim et al., 2021). Keep it small,
 * keep it stable.
 *
 * Registered with tf.serialization so checkpoint save/load round-trips
 * without manual rehydration.
 */
export class SelfAttentionLayer extends tf.layers.Layer {
  static className = "SelfAttentionLayer";

  private readonly dModel: number;
  private wq!: TF.LayerVariable;
  private wk!: TF.LayerVariable;
  private wv!: TF.LayerVariable;

  constructor(config: SelfAttentionConfig) {
    super(config as unknown as TF.serialization.ConfigDict);
    this.dModel = config.dModel;
  }

  build(inputShape: TF.Shape | TF.Shape[]): void {
    const shape = this.firstShape(inputShape);
    const featureDim = shape[shape.length - 1];
    if (typeof featureDim !== "number") {
      throw new Error("SelfAttentionLayer: last input dim must be statically known");
    }
    const initializer = tf.initializers.glorotUniform({});
    this.wq = this.addWeight("wq", [featureDim, this.dModel], "float32", initializer);
    this.wk = this.addWeight("wk", [featureDim, this.dModel], "float32", initializer);
    this.wv = this.addWeight("wv", [featureDim, this.dModel], "float32", initializer);
    super.build(inputShape);
  }

  call(inputs: TF.Tensor | TF.Tensor[]): TF.Tensor {
    return tf.tidy(() => {
      const x = (Array.isArray(inputs) ? inputs[0] : inputs) as TF.Tensor3D;
      const seqLen = x.shape[1] as number;
      const dIn = x.shape[2] as number;
      // tfjs-node 4.x has a buggy gradient for the 3D-by-2D matMul broadcast:
      // backprop returns a [batch, dIn, dModel] tensor where the weight expects
      // [dIn, dModel], and the optimizer rejects the shape mismatch. Flattening
      // batch+time into a single axis turns it into a plain 2D-by-2D matmul,
      // whose gradient is well-defined.
      const xFlat = x.reshape([-1, dIn]) as TF.Tensor2D;
      const qFlat = tf.matMul(xFlat, this.wq.read());
      const kFlat = tf.matMul(xFlat, this.wk.read());
      const vFlat = tf.matMul(xFlat, this.wv.read());
      const q = qFlat.reshape([-1, seqLen, this.dModel]) as TF.Tensor3D;
      const k = kFlat.reshape([-1, seqLen, this.dModel]) as TF.Tensor3D;
      const v = vFlat.reshape([-1, seqLen, this.dModel]) as TF.Tensor3D;
      const scale = Math.sqrt(this.dModel);
      const scores = tf.matMul(q, k, false, true).div(scale);
      const weights = tf.softmax(scores, -1);
      return tf.matMul(weights, v);
    });
  }

  computeOutputShape(inputShape: TF.Shape | TF.Shape[]): TF.Shape {
    const shape = this.firstShape(inputShape);
    return [shape[0], shape[1], this.dModel];
  }

  getConfig(): TF.serialization.ConfigDict {
    return { ...super.getConfig(), dModel: this.dModel };
  }

  private firstShape(inputShape: TF.Shape | TF.Shape[]): TF.Shape {
    if (Array.isArray(inputShape) && Array.isArray(inputShape[0])) {
      return inputShape[0] as TF.Shape;
    }
    return inputShape as TF.Shape;
  }
}

tf.serialization.registerClass(SelfAttentionLayer);

export interface SelfAttentionConfig {
  dModel: number;
  name?: string;
}
