import { Candle } from "../entities/Candle";

/**
 * First-Class Collection: wraps candle array and exposes behavior.
 * Object Calisthenics rule 4: collections must be their own classes.
 */
export class CandleSeries {
  constructor(private readonly candles: ReadonlyArray<Candle>) {
    if (candles.length === 0) throw new Error("CandleSeries is empty");
  }

  size(): number {
    return this.candles.length;
  }

  last(): Candle {
    return this.candles[this.candles.length - 1];
  }

  lastN(n: number): CandleSeries {
    return new CandleSeries(this.candles.slice(-n));
  }

  rangeFromIndex(start: number, end: number): CandleSeries {
    return new CandleSeries(this.candles.slice(start, end));
  }

  at(index: number): Candle {
    return this.candles[index];
  }

  closes(): ReadonlyArray<number> {
    return this.candles.map(c => c.closePrice().toNumber());
  }

  highs(): ReadonlyArray<number> {
    return this.candles.map(c => c.highPrice().toNumber());
  }

  lows(): ReadonlyArray<number> {
    return this.candles.map(c => c.lowPrice().toNumber());
  }

  volumes(): ReadonlyArray<number> {
    return this.candles.map(c => c.volumeAmount());
  }

  forEach(callback: (candle: Candle, index: number) => void): void {
    this.candles.forEach(callback);
  }

  toArray(): ReadonlyArray<Candle> {
    return this.candles;
  }
}
