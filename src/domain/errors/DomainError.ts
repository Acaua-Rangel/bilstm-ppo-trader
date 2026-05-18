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

/**
 * Thrown when the exchange is unreachable or rate-limiting us past the
 * retry budget. The session loop treats this as fatal: better to halt
 * than to keep blindly retrying with an open position.
 */
export class ExchangeUnavailableError extends DomainError {
  constructor(reason: string) {
    super(`Exchange unavailable: ${reason}`);
  }
}
