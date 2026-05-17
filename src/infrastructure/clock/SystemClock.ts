import { Clock } from "../../domain/ports/Clock";

/**
 * Adapter: wall-clock for INVEST mode.
 *
 * `awaitNext` sleeps for `intervalMs`. Sleep is interruptible via `cancel()`
 * so SIGINT does not need to wait for the full hour.
 */
export class SystemClock implements Clock {
  private cancelled = false;
  private pendingResolve: (() => void) | null = null;
  private pendingTimeout: NodeJS.Timeout | null = null;

  constructor(private readonly intervalMs: number) {
    if (intervalMs <= 0) throw new Error("SystemClock: intervalMs must be > 0");
  }

  hasNext(): boolean {
    return !this.cancelled;
  }

  awaitNext(): Promise<void> {
    if (this.cancelled) return Promise.resolve();
    return new Promise(resolve => {
      this.pendingResolve = resolve;
      this.pendingTimeout = setTimeout(() => this.fire(), this.intervalMs);
    });
  }

  cancel(): void {
    this.cancelled = true;
    this.fire();
  }

  private fire(): void {
    if (this.pendingTimeout !== null) {
      clearTimeout(this.pendingTimeout);
      this.pendingTimeout = null;
    }
    const resolve = this.pendingResolve;
    this.pendingResolve = null;
    if (resolve) resolve();
  }
}
