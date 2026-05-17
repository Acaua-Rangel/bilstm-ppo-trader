import { CandleSeries } from "../collections/CandleSeries";
import { TradingSymbol } from "../value-objects/TradingSymbol";

/**
 * Port: market data source. Implemented by real exchanges.
 * Interface Segregation: client depends only on what it needs.
 */
export interface MarketDataProvider {
  /**
   * Fetches `limit` candles ending `endOffsetCandles` before the most recent
   * available candle. When `endOffsetCandles` is 0/undefined, returns the
   * most recent `limit` candles. Used to keep training data and backtest
   * data disjoint (no data leakage).
   */
  fetchRecentCandles(
    symbol: TradingSymbol,
    limit: number,
    endOffsetCandles?: number
  ): Promise<CandleSeries>;
}
