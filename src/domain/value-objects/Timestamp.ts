export class Timestamp {
  private constructor(private readonly millis: number) {}

  static of(millis: number): Timestamp {
    return new Timestamp(millis);
  }

  static now(): Timestamp {
    return new Timestamp(Date.now());
  }

  toNumber(): number {
    return this.millis;
  }

  toISO(): string {
    return new Date(this.millis).toISOString();
  }
}
