import { tf } from "../tensorflow/tf";
import type * as TF from "@tensorflow/tfjs-node";
import { ForecastModel } from "../../domain/ports/ForecastModel";
import { FeatureMatrix } from "../../domain/collections/FeatureMatrix";

/**
 * Adapter: loads a pre-trained BiLSTM model from disk in TF.js graph format.
 *
 * The model is trained on Kaggle (notebooks/bilstm-ppo-self-attention-ai-spot-trading.ipynb)
 * and exported as a tfjs_graph_model (SavedModel → tensorflowjs_converter). The
 * custom SelfAttentionLayer is baked into the computation graph — no custom class
 * registration needed on the TypeScript side.
 *
 * Inference path: models/bilstm/model.json
 */
export class BiLSTMForecaster implements ForecastModel {
  private model!: Awaited<ReturnType<typeof tf.loadGraphModel>>;

  async predict(features: FeatureMatrix): Promise<ReadonlyArray<number>> {
    const inputTensor = tf.tensor3d(
      features.flatView(),
      [1, features.windowSize(), features.featuresPerStep()]
    );
    const raw = await this.model.executeAsync(
      inputTensor, 'Identity'
    ) as TF.Tensor | TF.Tensor[];
    const output = Array.isArray(raw) ? raw[0] : raw;
    const result = Array.from(await output.data());
    tf.dispose([inputTensor, ...(Array.isArray(raw) ? raw : [raw])]);
    return result;
  }

  async load(path: string): Promise<void> {
    this.model = await tf.loadGraphModel(`file://${path}/model.json`);
  }
}
