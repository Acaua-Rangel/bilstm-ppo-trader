import * as fs from "fs";
import * as path from "path";
import { ModelStorage } from "../../domain/ports/ModelStorage";
import { ForecasterTrainingState } from "../../domain/ports/ForecastModel";

const METADATA_VERSION = 1;
const METADATA_FILE = "metadata.json";
const FORECASTER_DIR = "forecaster";
const AGENT_DIR = "agent";

/**
 * Adapter: training checkpoint persistence.
 *
 * Layout under <checkpointDir>:
 *   metadata.json        — counters, schedules, input snapshot
 *   forecaster/          — BiLSTM weights (when forecaster has any progress)
 *   agent/policy/        — PPO actor weights (when agent has any progress)
 *   agent/value/         — PPO critic weights
 *
 * One checkpoint per directory; each save overwrites the previous one.
 * Use different --checkpoint paths to keep separate runs.
 */
export class CheckpointManager {
  constructor(
    private readonly checkpointDir: string,
    private readonly storage: ModelStorage
  ) {}

  get directory(): string {
    return this.checkpointDir;
  }

  exists(): boolean {
    return fs.existsSync(path.join(this.checkpointDir, METADATA_FILE));
  }

  async load(): Promise<CheckpointData | null> {
    if (!this.exists()) return null;
    const raw = fs.readFileSync(path.join(this.checkpointDir, METADATA_FILE), "utf-8");
    const data = JSON.parse(raw) as CheckpointData;
    if (data.version !== METADATA_VERSION) {
      throw new Error(
        `Checkpoint version mismatch: file is v${data.version}, expected v${METADATA_VERSION}`
      );
    }
    if (this.hasForecasterWeights()) {
      await this.storage.loadForecastModel(path.join(this.checkpointDir, FORECASTER_DIR));
    }
    if (this.hasAgentWeights()) {
      await this.storage.loadAgent(path.join(this.checkpointDir, AGENT_DIR));
    }
    return data;
  }

  async save(data: Omit<CheckpointData, "version" | "updatedAt">): Promise<void> {
    fs.mkdirSync(this.checkpointDir, { recursive: true });
    if (data.forecaster.completedEpochs > 0) {
      await this.storage.saveForecastModel(path.join(this.checkpointDir, FORECASTER_DIR));
    }
    if (data.agent.completedEpisodes > 0 || data.phase !== "forecaster") {
      await this.storage.saveAgent(path.join(this.checkpointDir, AGENT_DIR));
    }
    const final: CheckpointData = {
      version: METADATA_VERSION,
      createdAt: data.createdAt,
      updatedAt: new Date().toISOString(),
      phase: data.phase,
      input: data.input,
      forecaster: data.forecaster,
      agent: data.agent,
    };
    fs.writeFileSync(
      path.join(this.checkpointDir, METADATA_FILE),
      JSON.stringify(final, null, 2)
    );
  }

  private hasForecasterWeights(): boolean {
    return fs.existsSync(
      path.join(this.checkpointDir, FORECASTER_DIR, "model.json")
    );
  }

  private hasAgentWeights(): boolean {
    return fs.existsSync(
      path.join(this.checkpointDir, AGENT_DIR, "policy", "model.json")
    );
  }
}

export type TrainingPhase = "forecaster" | "agent" | "done";

export interface CheckpointData {
  version: number;
  createdAt: string;
  updatedAt: string;
  phase: TrainingPhase;
  input: TrainInputSnapshot;
  forecaster: ForecasterTrainingState;
  agent: AgentCheckpointState;
}

export interface AgentCheckpointState {
  completedEpisodes: number;
  updateCount: number;
}

export interface TrainInputSnapshot {
  symbol: string;
  historicalCandles: number;
  windowSize: number;
  horizon: number;
  forecastEpochs: number;
  rlEpisodes: number;
}
