import ccxt, { Exchange } from "ccxt";
import { MarketDataProvider } from "../../domain/ports/MarketDataProvider";
import { CandleSeries } from "../../domain/collections/CandleSeries";
import { Candle } from "../../domain/entities/Candle";
import { TradingSymbol } from "../../domain/value-objects/TradingSymbol";
import { Price } from "../../domain/value-objects/Price";
import { Timestamp } from "../../domain/value-objects/Timestamp";
import { MarketDataError } from "../../domain/errors/DomainError";

const TIMEFRAME_TO_MS: Record<string, number> = {
  "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000,
  "30m": 1_800_000, "1h": 3_600_000, "2h": 7_200_000, "4h": 14_400_000,
  "6h": 21_600_000, "8h": 28_800_000, "12h": 43_200_000, "1d": 86_400_000,
};

// Binance allows max 1000 candles per fetchOHLCV call.
const MAX_PER_REQUEST = 1000;

/**
 * Adapter: Binance via ccxt for market data.
 * No credentials needed — public data only.
 * Handles automatic pagination to support limits above 1000.
 */
export class BinanceMarketData implements MarketDataProvider {
  private readonly exchange: Exchange;
  private readonly timeframe: string;

  constructor(timeframe: string = "1h") {
    this.exchange = new ccxt.binance({ enableRateLimit: true });
    this.timeframe = timeframe;
  }

  async fetchRecentCandles(
    symbol: TradingSymbol,
    limit: number,
    endOffsetCandles: number = 0
  ): Promise<CandleSeries> {
    try {
      const tfMs = this.getTimeframeMs();
      const endTime = Date.now() - endOffsetCandles * tfMs;
      const startTime = endTime - limit * tfMs;
      const candles = await this.fetchWithPagination(symbol, startTime, endTime);
      return new CandleSeries(candles.slice(-limit));
    } catch (error) {
      throw new MarketDataError(String(error));
    }
  }

  private async fetchWithPagination(
    symbol: TradingSymbol,
    startTime: number,
    endTime: number
  ): Promise<Candle[]> {
    const allCandles: Candle[] = [];
    let since = startTime;

    while (since < endTime) {
      const raw = await this.exchange.fetchOHLCV(
        symbol.toString(), this.timeframe, since, MAX_PER_REQUEST
      );
      if (raw.length === 0) break;

      for (const row of raw) {
        const ts = row[0] as number;
        if (ts > endTime) break;
        allCandles.push(this.toCandle(row));
      }

      if (raw.length < MAX_PER_REQUEST) break;
      since = (raw[raw.length - 1][0] as number) + 1;
    }

    return allCandles;
  }

  private getTimeframeMs(): number {
    const tfMs = TIMEFRAME_TO_MS[this.timeframe];
    if (!tfMs) throw new MarketDataError(`Unknown timeframe: ${this.timeframe}`);
    return tfMs;
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
