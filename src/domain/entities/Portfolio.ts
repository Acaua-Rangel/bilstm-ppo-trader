import { Money } from "../value-objects/Money";
import { Position } from "./Position";

/**
 * Entity: consolidated Portfolio (cash + position).
 * Object Calisthenics: 2 instance variables only.
 */
export class Portfolio {
  private constructor(
    private readonly cash: Money,
    private readonly position: Position
  ) {}

  static initial(initialCash: Money): Portfolio {
    return new Portfolio(initialCash, Position.empty());
  }

  static rebuild(cash: Money, position: Position): Portfolio {
    return new Portfolio(cash, position);
  }

  availableCash(): Money {
    return this.cash;
  }

  currentPosition(): Position {
    return this.position;
  }

  withCash(newCash: Money): Portfolio {
    return new Portfolio(newCash, this.position);
  }

  withPosition(newPosition: Position): Portfolio {
    return new Portfolio(this.cash, newPosition);
  }
}
