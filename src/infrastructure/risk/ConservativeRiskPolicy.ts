import { RiskPolicy } from "../../domain/ports/RiskPolicy";
import { Money } from "../../domain/value-objects/Money";
import { Price } from "../../domain/value-objects/Price";
import { Percentage } from "../../domain/value-objects/Percentage";
import { Position } from "../../domain/entities/Position";
import { TradingAction } from "../../domain/enums/TradingAction";

/**
 * Adapter: conservative risk policy.
 * SRP: only responsible for risk rules. Configurable via constructor.
 */
export class ConservativeRiskPolicy implements RiskPolicy {
  private readonly maxPositionRiskPct: Percentage;
  private readonly stopLossPct: Percentage;
  private readonly maxDrawdownPct: Percentage;

  constructor(config: RiskConfig) {
    this.maxPositionRiskPct = Percentage.of(config.maxPositionRiskPct);
    this.stopLossPct = Percentage.of(config.stopLossPct);
    this.maxDrawdownPct = Percentage.of(config.maxDrawdownPct);
  }

  positionSizeFor(availableCash: Money): Money {
    return availableCash.multiply(this.maxPositionRiskPct.toNumber());
  }

  shouldStopOut(position: Position, currentPrice: Price): boolean {
    if (!position.isOpen()) return false;
    const pnl = position.unrealizedPnL(currentPrice);
    if (!pnl.isNegative()) return false;
    return pnl.exceedsInMagnitude(this.stopLossPct);
  }

  shouldHaltTrading(initialCapital: Money, currentEquity: Money): boolean {
    if (!currentEquity.isLessThan(initialCapital)) return false;
    const loss = initialCapital.subtract(currentEquity).toNumber();
    const lossPct = loss / initialCapital.toNumber();
    return lossPct > this.maxDrawdownPct.toNumber();
  }

  approve(action: TradingAction, availableCash: Money): boolean {
    if (action.isHold()) return true;
    if (action.isSell()) return true;
    return availableCash.isPositive();
  }
}

export interface RiskConfig {
  maxPositionRiskPct: number;
  stopLossPct: number;
  maxDrawdownPct: number;
}
