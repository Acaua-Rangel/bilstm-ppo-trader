/**
 * Enum: possible agent actions.
 * Object Calisthenics: replaces primitives 0/1/2 with objects with behavior.
 */
export class TradingAction {
  private constructor(
    private readonly code: number,
    private readonly label: string
  ) {}

  static readonly HOLD = new TradingAction(0, "HOLD");
  static readonly BUY = new TradingAction(1, "BUY");
  static readonly SELL = new TradingAction(2, "SELL");

  static fromCode(code: number): TradingAction {
    if (code === 0) return TradingAction.HOLD;
    if (code === 1) return TradingAction.BUY;
    if (code === 2) return TradingAction.SELL;
    throw new Error(`Invalid TradingAction: ${code}`);
  }

  isBuy(): boolean {
    return this === TradingAction.BUY;
  }

  isSell(): boolean {
    return this === TradingAction.SELL;
  }

  isHold(): boolean {
    return this === TradingAction.HOLD;
  }

  toCode(): number {
    return this.code;
  }

  toString(): string {
    return this.label;
  }
}
