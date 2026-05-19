import { tf } from "../tensorflow/tf";
import type * as TF from "@tensorflow/tfjs-node";
import { ForecastModel, EnsembleResult } from "../../domain/ports/ForecastModel";
import { FeatureMatrix } from "../../domain/collections/FeatureMatrix";

/**
 * Adapter: loads a pre-trained BiLSTM model from disk in TF.js graph format.
 *
 * The model is trained on Kaggle (notebooks/bilstm-ppo-self-attention-ai-spot-trading.ipynb)
 * and exported as a tfjs_graph_model (SavedModel → tensorflowjs_converter) so that the
 * custom SelfAttentionLayer is baked into the computation graph — no custom class
 * registration needed on the TypeScript side.
 *
 * Inference path: models/bilstm/model.json  (extracted from tfjs_models.zip)
 */
export class BiLSTMForecaster implements ForecastModel {
  // GraphModel returned by tf.loadGraphModel — typed via the return type since
  // @tensorflow/tfjs-node re-exports GraphModel from @tensorflow/tfjs.
  private model!: Awaited<ReturnType<typeof tf.loadGraphModel>>;

  async predict(features: FeatureMatrix): Promise<ReadonlyArray<number>> {
    const inputTensor = tf.tensor3d(
      features.flatView(),
      [1, features.windowSize(), features.featuresPerStep()]
    );
    // The BiLSTM graph contains LSTM dynamic ops (while-loop Exit nodes);
    // executeAsync with a direct tensor automatically maps to the sole input node,
    // avoiding hardcoded names like 'input_layer_4' which change per Kaggle session.
    const raw = await this.model.executeAsync(
      inputTensor, 'Identity'
    ) as TF.Tensor | TF.Tensor[];
    const output = Array.isArray(raw) ? raw[0] : raw;
    const result = Array.from(await output.data());
    tf.dispose([inputTensor, ...(Array.isArray(raw) ? raw : [raw])]);
    return result;
  }

  /**
   * Since the BiLSTM is loaded as a frozen graph model, dropout layers are
   * evaluated in inference mode (deterministic). True Monte Carlo Dropout is
   * not available. This method runs predict() once and returns a deterministic
   * confidence of 1.0, so downstream gates (regime, adaptive threshold, Platt)
   * remain the effective trade quality controls.
   */
  async predictWithUncertainty(
    features: FeatureMatrix, _runs?: number
  ): Promise<EnsembleResult> {
    const mean = Array.from(await this.predict(features));
    const horizon = mean.length;
    const variance = new Array<number>(horizon).fill(0);
    const confidence = new Array<number>(horizon).fill(1);
    return { mean, variance, confidence };
  }

  async load(path: string): Promise<void> {
    this.model = await tf.loadGraphModel(`file://${path}/model.json`);
  }
}
