/**
 * Value Object: Money in USD.
 * Object Calisthenics: wraps primitive, immutable, no setters.
 */
export class Money {
  private constructor(private readonly amount: number) {
    this.validate(amount);
  }

  static of(amount: number): Money {
    return new Money(amount);
  }

  static zero(): Money {
    return new Money(0);
  }

  private validate(amount: number): void {
    if (Number.isNaN(amount)) throw new Error("Money: NaN not allowed");
    if (!Number.isFinite(amount)) throw new Error("Money: infinite value");
  }

  add(other: Money): Money {
    return new Money(this.amount + other.amount);
  }

  subtract(other: Money): Money {
    return new Money(this.amount - other.amount);
  }

  multiply(factor: number): Money {
    return new Money(this.amount * factor);
  }

  isGreaterThan(other: Money): boolean {
    return this.amount > other.amount;
  }

  isLessThan(other: Money): boolean {
    return this.amount < other.amount;
  }

  isPositive(): boolean {
    return this.amount > 0;
  }

  toNumber(): number {
    return this.amount;
  }

  toString(): string {
    return `$${this.amount.toFixed(2)}`;
  }
}
