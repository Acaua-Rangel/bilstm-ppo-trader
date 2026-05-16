import * as fs from "fs";
import { ModelStorage } from "../../domain/ports/ModelStorage";
import { BiLSTMForecaster } from "../models/BiLSTMForecaster";
import { PPODecisionAgent } from "../models/PPODecisionAgent";

/**
 * Adapter: filesystem persistence.
 */
export class FileModelStorage implements ModelStorage {
  constructor(
    private readonly forecaster: BiLSTMForecaster,
    private readonly agent: PPODecisionAgent
  ) {}

  async saveForecastModel(path: string): Promise<void> {
    fs.mkdirSync(path, { recursive: true });
    await this.forecaster.save(path);
  }

  async loadForecastModel(path: string): Promise<void> {
    this.assertExists(`${path}/model.json`, "npm run train");
    await this.forecaster.load(path);
  }

  async saveAgent(path: string): Promise<void> {
    // tfjs saves to ${path}/policy and ${path}/value — pre-create both.
    fs.mkdirSync(`${path}/policy`, { recursive: true });
    fs.mkdirSync(`${path}/value`, { recursive: true });
    await this.agent.save(path);
  }

  async loadAgent(path: string): Promise<void> {
    this.assertExists(`${path}/policy/model.json`, "npm run train");
    await this.agent.load(path);
  }

  private assertExists(filePath: string, hint: string): void {
    if (!fs.existsSync(filePath)) {
      throw new Error(
        `Model not found: "${filePath}"\n` +
        `Run "${hint}" before using this command.`
      );
    }
  }
}
