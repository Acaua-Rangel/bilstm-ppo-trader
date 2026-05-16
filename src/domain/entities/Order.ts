import { TradingSymbol } from "../value-objects/TradingSymbol";
import { Quantity } from "../value-objects/Quantity";
import { Price } from "../value-objects/Price";
import { TradingAction } from "../enums/TradingAction";

/**
 * Entity: buy or sell order submitted to the executor.
 */
export class Order {
  private constructor(
    private readonly symbol: TradingSymbol,
    private readonly action: TradingAction,
    private readonly quantity: Quantity,
    private readonly executionPrice: Price
  ) {}

  static buy(symbol: TradingSymbol, quantity: Quantity, price: Price): Order {
    return new Order(symbol, TradingAction.BUY, quantity, price);
  }

  static sell(symbol: TradingSymbol, quantity: Quantity, price: Price): Order {
    return new Order(symbol, TradingAction.SELL, quantity, price);
  }

  tradingPair(): TradingSymbol {
    return this.symbol;
  }

  side(): TradingAction {
    return this.action;
  }

  amount(): Quantity {
    return this.quantity;
  }

  priceAtExecution(): Price {
    return this.executionPrice;
  }

  describe(): string {
    return `${this.action.toString()} ${this.quantity.toString()} ${this.symbol.toString()} @ ${this.executionPrice.toString()}`;
  }
}
