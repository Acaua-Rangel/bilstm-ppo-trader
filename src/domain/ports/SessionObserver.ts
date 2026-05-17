import { TradingAction } from "../enums/TradingAction";
import { Price } from "../value-objects/Price";
import { Money } from "../value-objects/Money";
import { Order } from "../entities/Order";

/**
 * Port: session observer.
 *
 * Receives lifecycle and per-tick events from the trading session. Adapters
 * decide what to do: aggregate metrics (BacktestObserver), stream to a log
 * (LiveLogObserver), persist to a database, etc.
 *
 * Adding new reporting requires a new adapter — the use case stays untouched.
 */
export interface SessionObserver {
  onSessionStart(context: SessionStartContext): void;
  onTick(event: TickEvent): void;
  onSessionEnd(summary: SessionSummary): void;
}

export interface SessionStartContext {
  initialEquity: Money;
  mode: "TEST" | "INVEST";
}

export interface TickEvent {
  action: TradingAction;
  price: Price;
  order: Order | null;
  forecast: ReadonlyArray<number>;
  equity: Money;
}

export interface SessionSummary {
  initialEquity: Money;
  finalEquity: Money;
  halted: boolean;
}
