import { Money } from "../value-objects/Money";
import { Price } from "../value-objects/Price";
import { Position } from "../entities/Position";
import { TradingAction } from "../enums/TradingAction";

/**
 * Port: risk policy. SRP — single responsibility is to evaluate risk.
 *
 * Includes symmetric exit guards (stop-out and take-profit) so the
 * risk-reward ratio is bounded by configuration, not by the agent's whim.
 * Halting decisions reference the current daily baseline (resettable at
 * UTC rollover) instead of session inception equity.
 */
export interface RiskPolicy {
  positionSizeFor(availableCash: Money): Money;
  shouldStopOut(position: Position, currentPrice: Price): boolean;
  shouldTakeProfit(position: Position, currentPrice: Price): boolean;
  shouldHaltTrading(dailyBaseline: Money, currentEquity: Money): boolean;
  approve(action: TradingAction, availableCash: Money): boolean;
}
