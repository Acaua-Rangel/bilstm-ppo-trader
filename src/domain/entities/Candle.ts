import { Price } from "../value-objects/Price";
import { Timestamp } from "../value-objects/Timestamp";

/**
 * Entity: OHLCV Candle.
 * Immutable. Encapsulates a single market candle.
 */
export class Candle {
  constructor(
    private readonly timestamp: Timestamp,
    private readonly open: Price,
    private readonly high: Price,
    private readonly low: Price,
    private readonly close: Price,
    private readonly volume: number
  ) {}

  closePrice(): Price {
    return this.close;
  }

  highPrice(): Price {
    return this.high;
  }

  lowPrice(): Price {
    return this.low;
  }

  openPrice(): Price {
    return this.open;
  }

  volumeAmount(): number {
    return this.volume;
  }

  occurredAt(): Timestamp {
    return this.timestamp;
  }

  range(): number {
    return this.high.toNumber() - this.low.toNumber();
  }
}
