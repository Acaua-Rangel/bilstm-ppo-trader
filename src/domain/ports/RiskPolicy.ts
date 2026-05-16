import { Money } from "../value-objects/Money";
import { Price } from "../value-objects/Price";
import { Position } from "../entities/Position";
import { TradingAction } from "../enums/TradingAction";

/**
 * Port: risk policy. SRP — single responsibility is to evaluate risk.
 */
export interface RiskPolicy {
  positionSizeFor(availableCash: Money): Money;
  shouldStopOut(position: Position, currentPrice: Price): boolean;
  shouldHaltTrading(initialCapital: Money, currentEquity: Money): boolean;
  approve(action: TradingAction, availableCash: Money): boolean;
}
