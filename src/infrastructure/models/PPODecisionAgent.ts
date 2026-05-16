import { tf } from "../tensorflow/tf";
import type * as TF from "@tensorflow/tfjs-node";
import { DecisionAgent, AgentDecision, AgentExperience } from "../../domain/ports/DecisionAgent";
import { TradingAction } from "../../domain/enums/TradingAction";

/**
 * Adapter: PPO agent on top of TensorFlow.js.
 * Implements the DecisionAgent port.
 */
export class PPODecisionAgent implements DecisionAgent {
  private policyNet: TF.LayersModel;
  private valueNet: TF.LayersModel;
  private experiences: AgentExperience[] = [];
  private readonly config: PPOConfig;
  private readonly policyOpt: TF.AdamOptimizer;
  private readonly valueOpt: TF.AdamOptimizer;
  private updateCount = 0;

  constructor(config: PPOConfig) {
    this.config = config;
    this.policyNet = this.buildPolicyNet();
    this.valueNet = this.buildValueNet();
    // Created once to preserve Adam state (momentum) across episodes.
    this.policyOpt = tf.train.adam(config.policyLR);
    this.valueOpt = tf.train.adam(config.valueLR);
  }

  private buildPolicyNet(): TF.LayersModel {
    const input = tf.input({ shape: [this.config.stateSize] });
    const hidden = this.buildHiddenLayers(input);
    const output = tf.layers.dense({
      units: this.config.actionSize, activation: "softmax",
    }).apply(hidden) as TF.SymbolicTensor;
    return tf.model({ inputs: input, outputs: output, name: "Actor" });
  }

  private buildValueNet(): TF.LayersModel {
    const input = tf.input({ shape: [this.config.stateSize] });
    const hidden = this.buildHiddenLayers(input);
    const output = tf.layers.dense({ units: 1 }).apply(hidden) as TF.SymbolicTensor;
    return tf.model({ inputs: input, outputs: output, name: "Critic" });
  }

  private buildHiddenLayers(input: TF.SymbolicTensor): TF.SymbolicTensor {
    const layer1 = tf.layers.dense({ units: 128, activation: "tanh" })
      .apply(input) as TF.SymbolicTensor;
    return tf.layers.dense({ units: 64, activation: "tanh" })
      .apply(layer1) as TF.SymbolicTensor;
  }

  async decide(state: ReadonlyArray<number>): Promise<AgentDecision> {
    const stateTensor = tf.tensor2d([Array.from(state)]);
    const probs = this.policyNet.predict(stateTensor) as TF.Tensor;
    const value = this.valueNet.predict(stateTensor) as TF.Tensor;
    const probsArray = Array.from(probs.dataSync());
    const estimatedValue = value.dataSync()[0];
    tf.dispose([stateTensor, probs, value]);
    const actionCode = this.sampleAction(probsArray);
    return {
      action: TradingAction.fromCode(actionCode),
      logProbability: Math.log(probsArray[actionCode] + 1e-8),
      estimatedValue,
    };
  }

  private sampleAction(probabilities: number[]): number {
    const random = Math.random();
    let cumulative = 0;
    for (let i = 0; i < probabilities.length; i++) {
      cumulative += probabilities[i];
      if (random < cumulative) return i;
    }
    return probabilities.length - 1;
  }

  recordExperience(experience: AgentExperience): void {
    this.experiences.push(experience);
  }

  async updatePolicy(): Promise<void> {
    if (this.experiences.length === 0) return;
    const advantages = this.computeAdvantages();
    const returns = this.computeReturns();
    await this.runPPOEpochs(advantages, returns);
    this.experiences = [];
    this.updateCount++;
    this.decayLR();
  }

  // Exponential decay: multiplies LR by lrDecay on each updatePolicy() call.
  private decayLR(): void {
    const factor = Math.pow(this.config.lrDecay, this.updateCount);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.policyOpt as any).learningRate = Math.max(
      this.config.policyLR * factor, this.config.minLR
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.valueOpt as any).learningRate = Math.max(
      this.config.valueLR * factor, this.config.minLR
    );
  }

  private computeAdvantages(): number[] {
    const advantages: number[] = new Array(this.experiences.length).fill(0);
    let lastAdvantage = 0;
    for (let t = this.experiences.length - 1; t >= 0; t--) {
      const mask = this.experiences[t].isTerminal ? 0 : 1;
      const nextValue = this.experiences[t + 1]?.estimatedValue ?? 0;
      const delta = this.experiences[t].reward
        + this.config.gamma * nextValue * mask
        - this.experiences[t].estimatedValue;
      lastAdvantage = delta + this.config.gamma * 0.95 * mask * lastAdvantage;
      advantages[t] = lastAdvantage;
    }
    return this.normalize(advantages);
  }

  private computeReturns(): number[] {
    const returns: number[] = new Array(this.experiences.length).fill(0);
    let lastReturn = 0;
    for (let t = this.experiences.length - 1; t >= 0; t--) {
      const mask = this.experiences[t].isTerminal ? 0 : 1;
      lastReturn = this.experiences[t].reward + this.config.gamma * mask * lastReturn;
      returns[t] = lastReturn;
    }
    return returns;
  }

  private normalize(values: number[]): number[] {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const std = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length) + 1e-8;
    return values.map(v => (v - mean) / std);
  }

  private async runPPOEpochs(advantages: number[], returns: number[]): Promise<void> {
    for (let epoch = 0; epoch < this.config.epochs; epoch++) {
      await this.runOneEpoch(advantages, returns, this.policyOpt, this.valueOpt);
    }
  }

  private async runOneEpoch(
    advantages: number[], returns: number[],
    policyOpt: TF.Optimizer, valueOpt: TF.Optimizer
  ): Promise<void> {
    const states = tf.tensor2d(this.experiences.map(e => Array.from(e.state)));
    const actions = tf.tensor1d(this.experiences.map(e => e.actionCode), "int32");
    const oldLogProbs = tf.tensor1d(this.experiences.map(e => e.logProbability));
    const advTensor = tf.tensor1d(advantages);
    const retTensor = tf.tensor1d(returns);
    this.updatePolicyNet(states, actions, advTensor, oldLogProbs, policyOpt);
    this.updateValueNet(states, retTensor, valueOpt);
    tf.dispose([states, actions, oldLogProbs, advTensor, retTensor]);
  }

  private updatePolicyNet(
    states: TF.Tensor, actions: TF.Tensor,
    advantages: TF.Tensor, oldLogProbs: TF.Tensor,
    optimizer: TF.Optimizer
  ): void {
    this.applyClippedGradients(() => {
      const probs = this.policyNet.predict(states) as TF.Tensor;
      const logProbs = probs.log().add(1e-8);
      const actionLP = logProbs.gather(actions, 1).squeeze();
      const ratio = actionLP.sub(oldLogProbs).exp();
      const surr1 = ratio.mul(advantages);
      const surr2 = ratio.clipByValue(
        1 - this.config.clipRatio, 1 + this.config.clipRatio
      ).mul(advantages);
      return tf.minimum(surr1, surr2).mean().neg() as TF.Scalar;
    }, optimizer);
  }

  private updateValueNet(states: TF.Tensor, returns: TF.Tensor, optimizer: TF.Optimizer): void {
    this.applyClippedGradients(() => {
      const values = (this.valueNet.predict(states) as TF.Tensor).squeeze();
      return tf.losses.meanSquaredError(returns, values) as TF.Scalar;
    }, optimizer);
  }

  // Global norm gradient clipping (PPO standard): limits ||grad||₂ ≤ maxGradNorm.
  private applyClippedGradients(lossFn: () => TF.Scalar, optimizer: TF.Optimizer): void {
    const { value, grads } = tf.variableGrads(lossFn);
    const gradNames = Object.keys(grads);
    const clippedGrads: TF.NamedTensorMap = {};
    tf.tidy(() => {
      const sqSum = tf.addN(gradNames.map(k => grads[k].square().sum()));
      const globalNorm = sqSum.sqrt();
      const clipCoef = tf.minimum(
        tf.scalar(1.0),
        tf.scalar(this.config.maxGradNorm).div(globalNorm.add(1e-6))
      );
      gradNames.forEach(k => {
        clippedGrads[k] = tf.keep(grads[k].mul(clipCoef));
      });
    });
    optimizer.applyGradients(clippedGrads);
    value.dispose();
    gradNames.forEach(k => {
      grads[k].dispose();
      clippedGrads[k].dispose();
    });
  }

  async save(path: string): Promise<void> {
    await this.policyNet.save(`file://${path}/policy`);
    await this.valueNet.save(`file://${path}/value`);
  }

  async load(path: string): Promise<void> {
    this.policyNet = await tf.loadLayersModel(`file://${path}/policy/model.json`);
    this.valueNet = await tf.loadLayersModel(`file://${path}/value/model.json`);
  }
}

export interface PPOConfig {
  stateSize: number;
  actionSize: number;
  gamma: number;
  clipRatio: number;
  policyLR: number;
  valueLR: number;
  minLR: number;
  lrDecay: number;
  maxGradNorm: number;
  epochs: number;
}
