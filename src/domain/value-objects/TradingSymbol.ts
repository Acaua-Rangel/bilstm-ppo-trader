export class TradingSymbol {
  private constructor(private readonly pair: string) {
    if (!pair.includes("/")) throw new Error(`Invalid symbol: ${pair}`);
  }

  static of(pair: string): TradingSymbol {
    return new TradingSymbol(pair);
  }

  toString(): string {
    return this.pair;
  }
}
