import { CandleSeries } from "../collections/CandleSeries";
import { TradingSymbol } from "../value-objects/TradingSymbol";

/**
 * Port: market data source. Implemented by real exchanges.
 * Interface Segregation: client depends only on what it needs.
 */
export interface MarketDataProvider {
  fetchRecentCandles(symbol: TradingSymbol, limit: number): Promise<CandleSeries>;
}
