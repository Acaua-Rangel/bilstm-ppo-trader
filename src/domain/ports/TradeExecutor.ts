import { Order } from "../entities/Order";
import { Money } from "../value-objects/Money";
import { Quantity } from "../value-objects/Quantity";
import { TradingSymbol } from "../value-objects/TradingSymbol";

/**
 * Port: order executor. Implemented by PaperExecutor (simulated),
 * BinanceTestnet (sandbox) or BinanceLive (real money).
 * Liskov: any implementation must be substitutable.
 */
export interface TradeExecutor {
  submit(order: Order): Promise<Order>;
  fetchCashBalance(): Promise<Money>;
  fetchHoldingQuantity(symbol: TradingSymbol): Promise<Quantity>;
  isLive(): boolean;
}
