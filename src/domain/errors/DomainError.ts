export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class InsufficientBalanceError extends DomainError {
  constructor() {
    super("Insufficient balance to execute order");
  }
}

export class RiskLimitExceededError extends DomainError {
  constructor(reason: string) {
    super(`Risk limit exceeded: ${reason}`);
  }
}

export class MarketDataError extends DomainError {
  constructor(reason: string) {
    super(`Market data error: ${reason}`);
  }
}
