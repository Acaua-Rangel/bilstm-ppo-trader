import { tf } from "../tensorflow/tf";
import type * as TF from "@tensorflow/tfjs-node";
import { DecisionAgent, AgentDecision } from "../../domain/ports/DecisionAgent";
import { TradingAction } from "../../domain/enums/TradingAction";

/**
 * Adapter: loads a pre-trained PPO agent (actor + critic) from disk.
 * Model is trained on Kaggle and imported via scripts/convert_kaggle_models.py.
 * Implements the DecisionAgent port.
 */
export class PPODecisionAgent implements DecisionAgent {
  private policyNet!: TF.GraphModel;
  private valueNet!: TF.GraphModel;

  async decide(state: ReadonlyArray<number>): Promise<AgentDecision> {
    const stateTensor = tf.tensor2d([Array.from(state)]);
    const probs = this.policyNet.predict(stateTensor) as TF.Tensor;
    const value = this.valueNet.predict(stateTensor) as TF.Tensor;
    const probsArray = Array.from(probs.dataSync());
    const estimatedValue = value.dataSync()[0];
    tf.dispose([stateTensor, probs, value]);
    const actionCode = this.getGreedyAction(probsArray);
    return {
      action: TradingAction.fromCode(actionCode),
      logProbability: Math.log(probsArray[actionCode] + 1e-8),
      estimatedValue,
    };
  }

  private getGreedyAction(probabilities: number[]): number {
    let bestAction = 0;
    let maxProb = -1;
    for (let i = 0; i < probabilities.length; i++) {
      if (probabilities[i] > maxProb) {
        maxProb = probabilities[i];
        bestAction = i;
      }
    }
    return bestAction;
  }

  async load(path: string): Promise<void> {
    this.policyNet = await tf.loadGraphModel(`file://${path}/policy/model.json`);
    this.valueNet = await tf.loadGraphModel(`file://${path}/value/model.json`);
  }
}
