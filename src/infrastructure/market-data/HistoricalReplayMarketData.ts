import { MarketDataProvider } from "../../domain/ports/MarketDataProvider";
import { CandleSeries } from "../../domain/collections/CandleSeries";
import { TradingSymbol } from "../../domain/value-objects/TradingSymbol";
import { PlaybackCursor } from "../clock/PlaybackCursor";

/**
 * Adapter: replays a pre-fetched candle series for TEST mode.
 *
 * Liskov-compatible with BinanceMarketData: same port, same signature.
 * The full historical series is loaded once at construction; on every
 * `fetchRecentCandles` call, returns the slice ending at the cursor — so
 * the trading cycle sees only "past" candles relative to the simulated now.
 *
 * Pairs with HistoricalClock through a shared PlaybackCursor.
 */
export class HistoricalReplayMarketData implements MarketDataProvider {
  constructor(
    private readonly fullSeries: CandleSeries,
    private readonly cursor: PlaybackCursor
  ) {}

  async fetchRecentCandles(
    _symbol: TradingSymbol,
    limit: number,
    endOffsetCandles: number = 0
  ): Promise<CandleSeries> {
    const endIndex = this.cursor.current() - endOffsetCandles;
    if (endIndex < 0) throw new Error("HistoricalReplayMarketData: cursor out of range");
    const startIndex = Math.max(0, endIndex - limit + 1);
    return this.fullSeries.rangeFromIndex(startIndex, endIndex + 1);
  }

  /**
   * Exposed so the BacktestObserver can peek at the next bar to compute
   * directional accuracy without crossing the simulated time barrier.
   */
  series(): CandleSeries {
    return this.fullSeries;
  }
}
