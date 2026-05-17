import { Clock } from "../../domain/ports/Clock";
import { PlaybackCursor } from "./PlaybackCursor";

/**
 * Adapter: simulated clock for TEST mode.
 *
 * `awaitNext` advances the shared cursor by one candle instantly. The
 * cursor is read by HistoricalReplayMarketData to decide which slice
 * of the pre-loaded series is visible at the simulated now.
 */
export class HistoricalClock implements Clock {
  private cancelled = false;

  constructor(private readonly cursor: PlaybackCursor) {}

  hasNext(): boolean {
    return !this.cancelled && this.cursor.canAdvance();
  }

  async awaitNext(): Promise<void> {
    if (this.cancelled) return;
    this.cursor.advance();
  }

  cancel(): void {
    this.cancelled = true;
  }
}
