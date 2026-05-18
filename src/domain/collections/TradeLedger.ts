import { Money } from "../value-objects/Money";

/**
 * First-class collection: closed trades + the rolling equity curve.
 * SRP — owns trade bookkeeping and the metrics derived from it.
 *
 * Metrics intentionally chosen to make the Gemini expectancy equation
 * tangible:
 *
 *   E = P_win · avgWin − P_loss · |avgLoss|
 *
 * `expectancyPerTrade` returns E directly in dollars. `profitFactor`
 * (gross wins / |gross losses|) is the standard sanity check: a value
 * below 1.0 means the strategy is bleeding even when win rate looks fine.
 */
export class TradeLedger {
  private readonly tradePnLs: number[] = [];
  private readonly equityCurve: number[] = [];
  private equityPeak: number = 0;
  private maxDrawdownPct: number = 0;

  recordEquity(equity: Money): void {
    const value = equity.toNumber();
    this.equityCurve.push(value);
    if (value > this.equityPeak) this.equityPeak = value;
    if (this.equityPeak <= 0) return;
    const drawdownPct = (this.equityPeak - value) / this.equityPeak;
    if (drawdownPct > this.maxDrawdownPct) this.maxDrawdownPct = drawdownPct;
  }

  recordClosedTrade(pnl: number): void {
    this.tradePnLs.push(pnl);
  }

  totalTrades(): number {
    return this.tradePnLs.length;
  }

  winCount(): number {
    return this.tradePnLs.filter(p => p > 0).length;
  }

  lossCount(): number {
    return this.tradePnLs.filter(p => p < 0).length;
  }

  winRate(): number {
    if (this.tradePnLs.length === 0) return 0;
    return this.winCount() / this.tradePnLs.length;
  }

  averageWin(): number {
    const wins = this.tradePnLs.filter(p => p > 0);
    if (wins.length === 0) return 0;
    return wins.reduce((a, b) => a + b, 0) / wins.length;
  }

  averageLoss(): number {
    const losses = this.tradePnLs.filter(p => p < 0);
    if (losses.length === 0) return 0;
    return losses.reduce((a, b) => a + b, 0) / losses.length;
  }

  /**
   * Per-trade expected value in dollars.
   *   E = P_win · avgWin − P_loss · |avgLoss|
   * If E < 0 the strategy loses money in expectation regardless of win rate.
   */
  expectancyPerTrade(): number {
    if (this.tradePnLs.length === 0) return 0;
    const total = this.tradePnLs.reduce((a, b) => a + b, 0);
    return total / this.tradePnLs.length;
  }

  /**
   * Profit factor: gross profit / |gross loss|.
   * 1.0 = break-even, < 1.0 = net loser, > 1.5 = generally considered healthy.
   * Returns Infinity when no losses occurred (rare — flag for overfitting).
   */
  profitFactor(): number {
    const grossProfit = this.tradePnLs.filter(p => p > 0).reduce((a, b) => a + b, 0);
    const grossLoss = Math.abs(this.tradePnLs.filter(p => p < 0).reduce((a, b) => a + b, 0));
    if (grossLoss === 0) return grossProfit > 0 ? Infinity : 0;
    return grossProfit / grossLoss;
  }

  /**
   * Average risk-reward ratio. > 1.0 means winners are larger than losers
   * on average — sustainable even when win rate dips below 50%.
   */
  riskRewardRatio(): number {
    const avgLoss = Math.abs(this.averageLoss());
    if (avgLoss === 0) return Infinity;
    return this.averageWin() / avgLoss;
  }

  /**
   * Maximum equity peak-to-trough drawdown observed across the session.
   * The whole-session circuit breaker uses a similar concept but resets
   * on UTC rollover; this metric never resets.
   */
  maxDrawdown(): number {
    return this.maxDrawdownPct;
  }

  totalPnL(): number {
    return this.tradePnLs.reduce((a, b) => a + b, 0);
  }
}
