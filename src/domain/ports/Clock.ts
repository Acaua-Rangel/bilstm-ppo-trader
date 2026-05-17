/**
 * Port: session clock.
 *
 * Drives the trading loop's pacing. Two adapters substitute here:
 *  - SystemClock: real wall-clock, sleeps between ticks (INVEST mode).
 *  - HistoricalClock: replays a candle cursor, advances instantly (TEST mode).
 *
 * The use case is identical for both modes; only the Clock adapter differs.
 */
export interface Clock {
  hasNext(): boolean;
  awaitNext(): Promise<void>;
  cancel(): void;
}
