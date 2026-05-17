import { ConsoleLogger } from "../infrastructure/logging/ConsoleLogger";
import { BinanceMarketData } from "../infrastructure/market-data/BinanceMarketData";
import { BiLSTMForecaster } from "../infrastructure/models/BiLSTMForecaster";
import { PPODecisionAgent } from "../infrastructure/models/PPODecisionAgent";
import { ConservativeRiskPolicy } from "../infrastructure/risk/ConservativeRiskPolicy";
import { PaperExecutor } from "../infrastructure/execution/PaperExecutor";
import { BinanceLiveExecutor } from "../infrastructure/execution/BinanceLiveExecutor";
import { FileModelStorage } from "../infrastructure/storage/FileModelStorage";
import { CheckpointManager } from "../infrastructure/storage/CheckpointManager";
import { FeatureBuilder } from "../application/services/FeatureBuilder";
import { TradingCycle } from "../application/services/TradingCycle";
import { TradingSymbol } from "../domain/value-objects/TradingSymbol";
import { Money } from "../domain/value-objects/Money";
import { Logger } from "../domain/ports/Logger";
import { TradeExecutor } from "../domain/ports/TradeExecutor";

/**
 * Composition Root: configures all dependencies.
 * Single place where concrete infrastructure is instantiated.
 * Dependency Inversion: everything here is injected into upper layers.
 */
export class Container {
  readonly logger: Logger;
  readonly marketData: BinanceMarketData;
  readonly forecaster: BiLSTMForecaster;
  readonly agent: PPODecisionAgent;
  readonly risk: ConservativeRiskPolicy;
  readonly storage: FileModelStorage;
  readonly featureBuilder: FeatureBuilder;
  readonly symbol: TradingSymbol;
  readonly initialCapital: Money;

  readonly environment: Environment;

  constructor(private readonly env: Environment) {
    this.environment = env;
    this.symbol = TradingSymbol.of(env.tradingSymbol);
    this.initialCapital = Money.of(env.initialCapitalUsd);
    this.logger = new ConsoleLogger();
    this.marketData = new BinanceMarketData(env.timeframe);
    this.featureBuilder = new FeatureBuilder(64);
    this.forecaster = new BiLSTMForecaster(this.biLSTMConfig());
    this.agent = new PPODecisionAgent(this.ppoConfig());
    this.risk = new ConservativeRiskPolicy(this.riskConfig());
    this.storage = new FileModelStorage(this.forecaster, this.agent);
  }

  buildPaperExecutor(): TradeExecutor {
    return new PaperExecutor(this.initialCapital, this.logger);
  }

  buildLiveExecutor(): TradeExecutor {
    return new BinanceLiveExecutor({
      apiKey: this.env.binanceApiKey,
      apiSecret: this.env.binanceApiSecret,
      testnet: this.env.binanceTestnet,
    }, this.logger);
  }

  buildCheckpointManager(directory: string): CheckpointManager {
    return new CheckpointManager(directory, this.storage);
  }

  buildTradingCycle(executor: TradeExecutor): TradingCycle {
    return new TradingCycle({
      marketData: this.marketData,
      executor, forecastModel: this.forecaster,
      agent: this.agent, risk: this.risk,
      logger: this.logger, featureBuilder: this.featureBuilder,
    }, { symbol: this.symbol, stopLossPct: this.env.stopLossPct });
  }

  private biLSTMConfig() {
    return {
      seqLen: 64, numFeatures: 10,
      hiddenUnits: 64, dropout: 0.2, horizon: 4,
      learningRate: 1e-3, minLR: 1e-5,
      l2: 1e-4, earlyStoppingPatience: 15,
    };
  }

  private ppoConfig() {
    return {
      stateSize: 13, actionSize: 3, gamma: 0.99,
      clipRatio: 0.2, policyLR: 3e-4, valueLR: 1e-3,
      minLR: 1e-5, lrDecay: 0.99, maxGradNorm: 0.5, epochs: 10,
    };
  }

  private riskConfig() {
    return {
      maxPositionRiskPct: this.env.maxPositionRiskPct,
      stopLossPct: this.env.stopLossPct,
      maxDrawdownPct: this.env.maxDailyDrawdownPct,
    };
  }
}

export interface Environment {
  tradingSymbol: string;
  timeframe: string;
  initialCapitalUsd: number;
  maxPositionRiskPct: number;
  stopLossPct: number;
  maxDailyDrawdownPct: number;
  binanceApiKey: string;
  binanceApiSecret: string;
  binanceTestnet: boolean;
}
