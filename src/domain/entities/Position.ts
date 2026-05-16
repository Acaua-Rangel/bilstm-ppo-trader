import { Quantity } from "../value-objects/Quantity";
import { Price } from "../value-objects/Price";
import { Percentage } from "../value-objects/Percentage";

/**
 * Entity: open position in an asset.
 */
export class Position {
  private constructor(
    private readonly quantity: Quantity,
    private readonly averageEntryPrice: Price
  ) {}

  static empty(): Position {
    return new Position(Quantity.zero(), Price.of(1));
  }

  static open(quantity: Quantity, entryPrice: Price): Position {
    return new Position(quantity, entryPrice);
  }

  isOpen(): boolean {
    return this.quantity.isPositive();
  }

  unrealizedPnL(currentPrice: Price): Percentage {
    if (!this.isOpen()) return Percentage.zero();
    return Percentage.of(this.averageEntryPrice.percentageChangeTo(currentPrice));
  }

  size(): Quantity {
    return this.quantity;
  }

  entryPrice(): Price {
    return this.averageEntryPrice;
  }
}
