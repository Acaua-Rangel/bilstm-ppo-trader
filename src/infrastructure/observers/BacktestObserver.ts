import { Logger } from "../../domain/ports/Logger";
import {
  SessionObserver,
  SessionStartContext,
  SessionSummary,
  TickEvent,
} from "../../domain/ports/SessionObserver";
import { Money } from "../../domain/value-objects/Money";
import { PlaybackCursor } from "../clock/PlaybackCursor";
import { CandleSeries } from "../../domain/collections/CandleSeries";
import { TradeLedger } from "../../domain/collections/TradeLedger";
import { SIGNAL_HORIZON_INDEX } from "../../application/services/TradingCycle";

const TARGET_MIN_RATE = 0.52;
const TARGET_MAX_RATE = 0.75;
const ACTUAL_HORIZON_BARS = SIGNAL_HORIZON_INDEX + 1;

/**
 * Adapter: aggregates per-tick events into a backtest report.
 *
 * Computes directional accuracy by peeking at the next bar in the
 * historical series (allowed because in replay mode the "future" is
 * already known — we just don't let the trading cycle see it).
 *
 * Trade bookkeeping (win rate, expectancy, profit factor, max drawdown)
 * is delegated to TradeLedger so this class only orchestrates events.
 */
export class BacktestObserver implements SessionObserver {
  private directionalHits = 0;
  private directionalTotal = 0;
  private equityAtOpen: Money | null = null;
  private initialEquity: Money = Money.zero();
  private readonly ledger: TradeLedger = new TradeLedger();

  constructor(
    private readonly logger: Logger,
    private readonly fullSeries: CandleSeries,
    private readonly cursor: PlaybackCursor
  ) {}

  onSessionStart(context: SessionStartContext): void {
    this.logger.info(`=== ${context.mode} MODE (backtest with real data) ===`, {
      initialEquity: context.initialEquity.toString(),
    });
    this.initialEquity = context.initialEquity;
    this.ledger.recordEquity(context.initialEquity);
  }

  onTick(event: TickEvent): void {
    this.ledger.recordEquity(event.equity);
    this.trackDirectional(event);
    this.trackTrade(event);
  }

  onSessionEnd(summary: SessionSummary): void {
    this.ledger.recordEquity(summary.finalEquity);
    const directionalAccuracy = this.directionalTotal === 0
      ? 0 : this.directionalHits / this.directionalTotal;
    const totalReturnPct = ((summary.finalEquity.toNumber() - this.initialEquity.toNumber())
      / this.initialEquity.toNumber()) * 100;
    const netDelta = summary.finalEquity.toNumber() - this.initialEquity.toNumber();

    this.logger.info("=== BACKTEST REPORT ===");
    this.logger.info(`Directional accuracy (forecaster): ${(directionalAccuracy * 100).toFixed(2)}% (${this.directionalTotal} predictions)`);
    this.logExpectancyBlock();
    this.logStreakBlock();
    this.logger.info(`Accumulated trade PnL: ${this.formatSigned(this.ledger.totalPnL())}`);
    this.logger.info(`Final equity: ${summary.finalEquity.toString()} (initial: ${this.initialEquity.toString()})`);
    this.logger.info(`Net session PnL: ${this.formatSigned(netDelta)} (${this.formatSignedPct(totalReturnPct)})`);
    this.logger.info(`Max drawdown (peak-to-trough equity): ${(this.ledger.maxDrawdown() * 100).toFixed(2)}%`);
    if (summary.halted) {
      this.logger.warn("Backtest halted early by circuit breaker (max drawdown exceeded)");
    }
    this.logger.info(this.targetVerdict());
    this.logger.info(this.expectancyVerdict());
  }

  private logExpectancyBlock(): void {
    const trades = this.ledger.totalTrades();
    const wins = this.ledger.winCount();
    const losses = this.ledger.lossCount();
    const winRate = this.ledger.winRate() * 100;
    const avgWin = this.ledger.averageWin();
    const avgLoss = this.ledger.averageLoss();
    const expectancy = this.ledger.expectancyPerTrade();
    const profitFactor = this.ledger.profitFactor();
    const rrRatio = this.ledger.riskRewardRatio();

    this.logger.info(`Win rate (closed trades): ${winRate.toFixed(2)}% (${wins}W / ${losses}L across ${trades} trades)`);
    this.logger.info(`Avg win: ${this.formatSigned(avgWin)} | Avg loss: ${this.formatSigned(avgLoss)} | R:R ratio: ${this.formatRatio(rrRatio)}`);
    this.logger.info(`Expectancy / trade: ${this.formatSigned(expectancy)} | Profit factor: ${this.formatRatio(profitFactor)}`);
  }

  /**
   * Streak metrics validate the assumption behind the martingale-style
   * StreakSizingMultiplier: if avg/median loss streak ≈ 1 and max ≤ 2,
   * the heuristic is safe; if max grows beyond 3 the cap will be hit and
   * the strategy bleeds on those runs.
   */
  private logStreakBlock(): void {
    const winAvg = this.ledger.averageWinStreak();
    const winMed = this.ledger.medianWinStreak();
    const winMax = this.ledger.maxWinStreak();
    const winRuns = this.ledger.winStreakLengths().length;
    const lossAvg = this.ledger.averageLossStreak();
    const lossMed = this.ledger.medianLossStreak();
    const lossMax = this.ledger.maxLossStreak();
    const lossRuns = this.ledger.lossStreakLengths().length;
    this.logger.info(
      `Win streaks: avg ${winAvg.toFixed(2)} | median ${winMed.toFixed(2)} | max ${winMax} (${winRuns} runs)`
    );
    this.logger.info(
      `Loss streaks: avg ${lossAvg.toFixed(2)} | median ${lossMed.toFixed(2)} | max ${lossMax} (${lossRuns} runs)`
    );
  }

  private trackDirectional(event: TickEvent): void {
    const idx = this.cursor.current();
    if (idx + ACTUAL_HORIZON_BARS >= this.fullSeries.size()) return;
    const currentClose = this.fullSeries.at(idx).closePrice().toNumber();
    const futureClose = this.fullSeries.at(idx + ACTUAL_HORIZON_BARS).closePrice().toNumber();
    const actualReturn = futureClose - currentClose;
    if (actualReturn === 0) return;
    const predicted = event.forecast[SIGNAL_HORIZON_INDEX] ?? 0;
    if (Math.sign(predicted) === Math.sign(actualReturn)) this.directionalHits++;
    this.directionalTotal++;
  }

  private trackTrade(event: TickEvent): void {
    if (event.order === null) return;
    if (event.action.isBuy()) {
      this.equityAtOpen = event.equity;
      return;
    }
    if (event.action.isSell() && this.equityAtOpen !== null) {
      const open = this.equityAtOpen.toNumber();
      const close = event.equity.toNumber();
      const pnl = close - open;
      const pct = (pnl / open) * 100;
      this.ledger.recordClosedTrade(pnl);
      this.logger.info(`TRADE CLOSED — ${pnl >= 0 ? "WIN" : "LOSS"}`, {
        trade: this.ledger.totalTrades(),
        realizedPnL: `${this.formatSigned(pnl)} (${this.formatSignedPct(pct)})`,
        equityAtOpen: this.equityAtOpen.toString(),
        equityAtClose: event.equity.toString(),
      });
      this.equityAtOpen = null;
    }
  }

  private formatSigned(value: number): string {
    const sign = value >= 0 ? "+" : "";
    return `${sign}$${value.toFixed(2)}`;
  }

  private formatSignedPct(value: number): string {
    const sign = value >= 0 ? "+" : "";
    return `${sign}${value.toFixed(2)}%`;
  }

  private formatRatio(value: number): string {
    if (!Number.isFinite(value)) return "∞";
    return value.toFixed(2);
  }

  private targetVerdict(): string {
    const trades = this.ledger.totalTrades();
    const winRate = this.ledger.winRate();
    if (trades < 5) {
      return `[WARNING] Only ${trades} trade(s) — insufficient sample to validate win rate.`;
    }
    const pct = (winRate * 100).toFixed(2);
    if (winRate >= TARGET_MIN_RATE && winRate <= TARGET_MAX_RATE) {
      return `[OK] Win rate ${pct}% is within target range (52% - 75%).`;
    }
    if (winRate < TARGET_MIN_RATE) {
      return `[BELOW] Win rate ${pct}% < 52%. Model does not beat random consistently — consider more training or adjustments.`;
    }
    return `[ABOVE] Win rate ${pct}% > 75%. Suspect overfitting or data leakage.`;
  }

  /**
   * Verdict that actually matters for capital preservation: expectancy + PF.
   * A 56% win rate with PF < 1.0 still bleeds; this surface lets the user
   * see that immediately instead of celebrating the accuracy number alone.
   */
  private expectancyVerdict(): string {
    const trades = this.ledger.totalTrades();
    if (trades < 5) {
      return "[WARNING] Expectancy/PF not statistically meaningful below 5 trades.";
    }
    const expectancy = this.ledger.expectancyPerTrade();
    const pf = this.ledger.profitFactor();
    if (expectancy > 0 && pf >= 1.5) {
      return `[OK] Expectancy ${this.formatSigned(expectancy)}/trade and PF ${this.formatRatio(pf)} — strategy is viable.`;
    }
    if (expectancy > 0 && pf >= 1.0) {
      return `[MARGINAL] Expectancy ${this.formatSigned(expectancy)}/trade and PF ${this.formatRatio(pf)} — net positive but slim; live costs likely flip it negative.`;
    }
    return `[BLEED] Expectancy ${this.formatSigned(expectancy)}/trade and PF ${this.formatRatio(pf)} — strategy loses money in expectation.`;
  }
}
