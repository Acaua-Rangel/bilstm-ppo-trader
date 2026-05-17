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

const TARGET_MIN_RATE = 0.52;
const TARGET_MAX_RATE = 0.75;

/**
 * Adapter: aggregates per-tick events into a backtest report.
 *
 * Computes directional accuracy by peeking at the next bar in the
 * historical series (allowed because in replay mode the "future" is
 * already known — we just don't let the trading cycle see it).
 *
 * Computes win rate by tracking equity at position-open ticks and
 * comparing with equity at position-close ticks.
 */
export class BacktestObserver implements SessionObserver {
  private directionalHits = 0;
  private directionalTotal = 0;
  private wins = 0;
  private losses = 0;
  private totalTrades = 0;
  private totalTradePnL = 0;
  private equityAtOpen: Money | null = null;
  private initialEquity: Money = Money.zero();

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
  }

  onTick(event: TickEvent): void {
    this.trackDirectional(event);
    this.trackTrade(event);
  }

  onSessionEnd(summary: SessionSummary): void {
    const directionalAccuracy = this.directionalTotal === 0
      ? 0 : this.directionalHits / this.directionalTotal;
    const winRate = this.totalTrades === 0
      ? 0 : this.wins / this.totalTrades;
    const totalReturnPct = ((summary.finalEquity.toNumber() - this.initialEquity.toNumber())
      / this.initialEquity.toNumber()) * 100;

    const netDelta = summary.finalEquity.toNumber() - this.initialEquity.toNumber();
    this.logger.info("=== BACKTEST REPORT ===");
    this.logger.info(`Directional accuracy (forecaster): ${(directionalAccuracy * 100).toFixed(2)}% (${this.directionalTotal} predictions)`);
    this.logger.info(`Win rate (closed trades): ${(winRate * 100).toFixed(2)}% (${this.wins}W / ${this.losses}L across ${this.totalTrades} trades)`);
    this.logger.info(`Accumulated trade PnL: ${this.formatSigned(this.totalTradePnL)}`);
    this.logger.info(`Final equity: ${summary.finalEquity.toString()} (initial: ${this.initialEquity.toString()})`);
    this.logger.info(`Net session PnL: ${this.formatSigned(netDelta)} (${this.formatSignedPct(totalReturnPct)})`);
    if (summary.halted) {
      this.logger.warn("Backtest halted early by circuit breaker (max drawdown exceeded)");
    }
    this.logger.info(this.targetVerdict(winRate));
  }

  private trackDirectional(event: TickEvent): void {
    const idx = this.cursor.current();
    if (idx + 1 >= this.fullSeries.size()) return;
    const currentClose = this.fullSeries.at(idx).closePrice().toNumber();
    const nextClose = this.fullSeries.at(idx + 1).closePrice().toNumber();
    const actualReturn = nextClose - currentClose;
    if (actualReturn === 0) return;
    const predicted = event.forecast[0] ?? 0;
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
      this.totalTradePnL += pnl;
      if (pnl > 0) this.wins++; else this.losses++;
      this.totalTrades++;
      this.logger.info(`TRADE CLOSED — ${pnl >= 0 ? "WIN" : "LOSS"}`, {
        trade: this.totalTrades,
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

  private targetVerdict(winRate: number): string {
    if (this.totalTrades < 5) {
      return `[WARNING] Only ${this.totalTrades} trade(s) — insufficient sample to validate win rate.`;
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
}
