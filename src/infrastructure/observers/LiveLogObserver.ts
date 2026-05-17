import { Logger } from "../../domain/ports/Logger";
import {
  SessionObserver,
  SessionStartContext,
  SessionSummary,
  TickEvent,
} from "../../domain/ports/SessionObserver";
import { Money } from "../../domain/value-objects/Money";

/**
 * Adapter: streams session events to the structured logger.
 *
 * On every tick, reports the PnL since session start so the running gain
 * or loss is always visible. On each closed trade, emits a dedicated log
 * line with the realized PnL of that round-trip.
 */
export class LiveLogObserver implements SessionObserver {
  private initialEquity: Money = Money.zero();
  private equityAtOpen: Money | null = null;
  private wins = 0;
  private losses = 0;
  private totalRealizedPnL = 0;

  constructor(private readonly logger: Logger) {}

  onSessionStart(context: SessionStartContext): void {
    this.initialEquity = context.initialEquity;
    this.logger.info(`=== ${context.mode} MODE started ===`, {
      initialEquity: context.initialEquity.toString(),
    });
  }

  onTick(event: TickEvent): void {
    const delta = event.equity.toNumber() - this.initialEquity.toNumber();
    const pct = (delta / this.initialEquity.toNumber()) * 100;
    this.logger.info("Tick executed", {
      action: event.action.toString(),
      price: event.price.toString(),
      filled: event.order ? event.order.describe() : "—",
      equity: event.equity.toString(),
      pnlSinceStart: `${this.formatSigned(delta)} (${this.formatSignedPct(pct)})`,
    });
    this.trackTrade(event);
  }

  onSessionEnd(summary: SessionSummary): void {
    const delta = summary.finalEquity.toNumber() - summary.initialEquity.toNumber();
    const pct = (delta / summary.initialEquity.toNumber()) * 100;
    this.logger.info("=== Session ended ===", {
      initialEquity: summary.initialEquity.toString(),
      finalEquity: summary.finalEquity.toString(),
      netPnL: `${this.formatSigned(delta)} (${this.formatSignedPct(pct)})`,
      closedTrades: this.wins + this.losses,
      wins: this.wins,
      losses: this.losses,
      realizedPnL: this.formatSigned(this.totalRealizedPnL),
      halted: summary.halted,
    });
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
      const tradePnL = close - open;
      const tradePct = (tradePnL / open) * 100;
      this.totalRealizedPnL += tradePnL;
      if (tradePnL > 0) this.wins++; else this.losses++;
      this.logger.info(`TRADE CLOSED — ${tradePnL >= 0 ? "WIN" : "LOSS"}`, {
        realizedPnL: `${this.formatSigned(tradePnL)} (${this.formatSignedPct(tradePct)})`,
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
}
