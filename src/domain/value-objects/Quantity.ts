export class Quantity {
  private constructor(private readonly value: number) {
    this.validate(value);
  }

  static of(value: number): Quantity {
    return new Quantity(value);
  }

  static zero(): Quantity {
    return new Quantity(0);
  }

  private validate(value: number): void {
    if (value < 0) throw new Error("Quantity cannot be negative");
    if (!Number.isFinite(value)) throw new Error("Quantity must be finite");
  }

  isZero(): boolean {
    return this.value === 0;
  }

  isPositive(): boolean {
    return this.value > 0;
  }

  toNumber(): number {
    return this.value;
  }

  toString(): string {
    return this.value.toFixed(8);
  }
}
