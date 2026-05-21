import "dotenv/config";
import { Cli } from "./cli/Cli";
import { Environment } from "./cli/Container";

/**
 * Entry point: loads env, builds CLI, dispatches.
 * Intentionally kept minimal.
 */
async function bootstrap(): Promise<void> {
  const env = loadEnvironment();
  const cli = new Cli(env);
  const args = process.argv.slice(2);
  await cli.run(args);
}

function loadEnvironment(): Environment {
  return {
    tradingSymbol: required("TRADING_SYMBOL"),
    timeframe: required("TRADING_TIMEFRAME"),
    initialCapitalUsd: parseFloat(required("INITIAL_CAPITAL_USD")),
    maxPositionRiskPct: parseFloat(required("MAX_POSITION_RISK_PCT")),
    stopLossPct: parseFloat(required("STOP_LOSS_PCT")),
    takeProfitPct: parseFloat(required("TAKE_PROFIT_PCT")),
    maxDailyDrawdownPct: parseFloat(required("MAX_DAILY_DRAWDOWN_PCT")),
    slippagePct: parseFloat(required("SLIPPAGE_PCT")),
    binanceApiKey: process.env.BINANCE_API_KEY ?? "",
    binanceApiSecret: process.env.BINANCE_API_SECRET ?? "",
    binanceTestnet: process.env.BINANCE_TESTNET === "true",
    stateFilePath: process.env.STATE_FILE_PATH ?? ".runtime/trading-state.json",
  };
}

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Required environment variable: ${key}`);
  return value;
}

bootstrap().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});
