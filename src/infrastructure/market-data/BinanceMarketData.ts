import ccxt, { Exchange } from "ccxt";
import { MarketDataProvider } from "../../domain/ports/MarketDataProvider";
import { CandleSeries } from "../../domain/collections/CandleSeries";
import { Candle } from "../../domain/entities/Candle";
import { TradingSymbol } from "../../domain/value-objects/TradingSymbol";
import { Price } from "../../domain/value-objects/Price";
import { Timestamp } from "../../domain/value-objects/Timestamp";
import { MarketDataError } from "../../domain/errors/DomainError";

/**
 * Adapter: Binance via ccxt for market data.
 * No credentials needed — public data only.
 */
export class BinanceMarketData implements MarketDataProvider {
  private readonly exchange: Exchange;
  private readonly timeframe: string;

  constructor(timeframe: string = "1h") {
    this.exchange = new ccxt.binance({ enableRateLimit: true });
    this.timeframe = timeframe;
  }

  async fetchRecentCandles(symbol: TradingSymbol, limit: number): Promise<CandleSeries> {
    try {
      const raw = await this.exchange.fetchOHLCV(
        symbol.toString(), this.timeframe, undefined, limit
      );
      const candles = raw.map(row => this.toCandle(row));
      return new CandleSeries(candles);
    } catch (error) {
      throw new MarketDataError(String(error));
    }
  }

  private toCandle(row: (number | undefined)[]): Candle {
    const [ts, open, high, low, close, volume] = row as number[];
    return new Candle(
      Timestamp.of(ts),
      Price.of(open),
      Price.of(high),
      Price.of(low),
      Price.of(close),
      volume
    );
  }
}
