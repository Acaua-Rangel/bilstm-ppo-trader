export class Percentage {
  private constructor(private readonly value: number) {
    if (!Number.isFinite(value)) throw new Error("Percentage: invalid value");
  }

  static of(value: number): Percentage {
    return new Percentage(value);
  }

  static zero(): Percentage {
    return new Percentage(0);
  }

  exceedsInMagnitude(other: Percentage): boolean {
    return Math.abs(this.value) > Math.abs(other.value);
  }

  isNegative(): boolean {
    return this.value < 0;
  }

  toNumber(): number {
    return this.value;
  }

  toString(): string {
    return `${(this.value * 100).toFixed(2)}%`;
  }
}
