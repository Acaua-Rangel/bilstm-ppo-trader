export class Price {
  private constructor(private readonly value: number) {
    this.validate(value);
  }

  static of(value: number): Price {
    return new Price(value);
  }

  private validate(value: number): void {
    if (value <= 0) throw new Error(`Price must be positive: ${value}`);
    if (!Number.isFinite(value)) throw new Error("Price must be finite");
  }

  percentageChangeTo(other: Price): number {
    return (other.value - this.value) / this.value;
  }

  isAbove(other: Price): boolean {
    return this.value > other.value;
  }

  isBelow(other: Price): boolean {
    return this.value < other.value;
  }

  toNumber(): number {
    return this.value;
  }

  toString(): string {
    return this.value.toFixed(2);
  }
}
