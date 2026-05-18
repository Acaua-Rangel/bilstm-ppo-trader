/**
 * Service: temporal train/validation split with purge and embargo.
 *
 * BiLSTM is bidirectional *within* its input window; that is safe.
 * The leakage risk is on the *target* side: sample i has a label that
 * looks `horizon` candles into the future. A naive trailing split lets
 * training samples just before the validation boundary peek at the same
 * future candles their validation neighbors see.
 *
 * - Purge: drop training samples whose target window reaches into the
 *   validation set (i + horizon >= valStart).
 * - Embargo: drop an additional buffer of training samples adjacent to
 *   the validation set. Necessary because serial correlation in returns
 *   means yesterday's residual still informs today's, even past the
 *   horizon boundary. López de Prado, "Advances in Financial ML", §7.4.
 */
export class PurgedEmbargoedSplit {
  constructor(
    private readonly horizon: number,
    private readonly embargoFraction: number
  ) {
    if (horizon < 0) throw new Error("PurgedEmbargoedSplit: horizon must be >= 0");
    if (embargoFraction < 0 || embargoFraction >= 1) {
      throw new Error("PurgedEmbargoedSplit: embargoFraction must be in [0, 1)");
    }
  }

  split<T>(items: T[], validationFraction: number): SplitResult<T> {
    if (validationFraction <= 0 || validationFraction >= 1) {
      throw new Error("PurgedEmbargoedSplit: validationFraction must be in (0, 1)");
    }
    const total = items.length;
    const validationSize = Math.floor(total * validationFraction);
    const validationStart = total - validationSize;
    const embargoSize = Math.floor(total * this.embargoFraction);
    const trainEnd = Math.max(0, validationStart - this.horizon - embargoSize);
    return {
      train: items.slice(0, trainEnd),
      validation: items.slice(validationStart, total),
      purgedCount: validationStart - trainEnd,
    };
  }
}

export interface SplitResult<T> {
  train: T[];
  validation: T[];
  /** Number of samples dropped between train and validation (horizon + embargo). */
  purgedCount: number;
}
