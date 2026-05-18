import * as fs from "fs";
import { ModelStorage } from "../../domain/ports/ModelStorage";
import { BiLSTMForecaster } from "../models/BiLSTMForecaster";
import { PPODecisionAgent } from "../models/PPODecisionAgent";

/**
 * Adapter: loads pre-trained models (tfjs_graph_model / tfjs_layers_model) from
 * the local filesystem.
 *
 * Models are trained on Kaggle and exported automatically during the run:
 *   https://www.kaggle.com/code/acaurangel/bilstm-ppo-self-attention-ai-spot-trading
 *
 * Setup:
 *   1. Download tfjs_models.zip from the Kaggle output panel.
 *   2. Extract the zip into ./models/ — the expected structure is:
 *        models/bilstm/model.json          ← BiLSTM (graph model)
 *        models/ppo/policy/model.json      ← PPO actor (layers model)
 *        models/ppo/value/model.json       ← PPO critic (layers model)
 */
export class FileModelStorage implements ModelStorage {
  constructor(
    private readonly forecaster: BiLSTMForecaster,
    private readonly agent: PPODecisionAgent
  ) {}

  async loadForecastModel(path: string): Promise<void> {
    this.assertExists(`${path}/model.json`, path);
    await this.forecaster.load(path);
  }

  async loadAgent(path: string): Promise<void> {
    this.assertExists(`${path}/policy/model.json`, path);
    await this.agent.load(path);
  }

  private assertExists(filePath: string, modelPath: string): void {
    if (!fs.existsSync(filePath)) {
      throw new Error(
        `Model not found: "${filePath}"\n` +
        `Download tfjs_models.zip from the Kaggle output panel and extract into ./models/\n` +
        `Notebook: https://www.kaggle.com/code/acaurangel/bilstm-ppo-self-attention-ai-spot-trading\n` +
        `Expected: ${modelPath}`
      );
    }
  }
}
