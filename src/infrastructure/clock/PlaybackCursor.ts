/**
 * Shared cursor for historical replay.
 *
 * HistoricalClock advances it; HistoricalReplayMarketData reads it to decide
 * which slice of the pre-fetched series is "visible" at the simulated now.
 *
 * Mutable on purpose — it represents the simulated wall-clock and is meant
 * to be shared between the clock adapter and the market-data adapter so
 * they remain coherent without coupling them through the use case.
 */
export class PlaybackCursor {
  private index: number;

  constructor(private readonly startIndex: number, private readonly endIndex: number) {
    if (startIndex < 0) throw new Error("PlaybackCursor: startIndex must be >= 0");
    if (endIndex < startIndex) throw new Error("PlaybackCursor: endIndex must be >= startIndex");
    this.index = startIndex;
  }

  current(): number {
    return this.index;
  }

  advance(): void {
    if (this.canAdvance()) this.index++;
  }

  canAdvance(): boolean {
    return this.index < this.endIndex;
  }

  start(): number {
    return this.startIndex;
  }

  end(): number {
    return this.endIndex;
  }
}
