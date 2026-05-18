import { TradingAction } from "../enums/TradingAction";

/**
 * Port: decision agent (PPO or other).
 */
export interface DecisionAgent {
  decide(stateFeatures: ReadonlyArray<number>): Promise<AgentDecision>;
}

export interface AgentDecision {
  action: TradingAction;
  logProbability: number;
  estimatedValue: number;
}
