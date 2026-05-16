import { TradingAction } from "../enums/TradingAction";

/**
 * Port: decision agent (PPO or other).
 */
export interface DecisionAgent {
  decide(stateFeatures: ReadonlyArray<number>): Promise<AgentDecision>;
  recordExperience(experience: AgentExperience): void;
  updatePolicy(): Promise<void>;
}

export interface AgentDecision {
  action: TradingAction;
  logProbability: number;
  estimatedValue: number;
}

export interface AgentExperience {
  state: ReadonlyArray<number>;
  actionCode: number;
  reward: number;
  logProbability: number;
  estimatedValue: number;
  isTerminal: boolean;
}
