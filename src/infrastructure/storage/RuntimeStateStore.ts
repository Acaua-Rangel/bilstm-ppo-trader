import * as fs from "fs";
import * as path from "path";
import { Logger } from "../../domain/ports/Logger";

/**
 * Per-session runtime state that must survive restarts so the trading cycle
 * can resume with the right anchors:
 *   - entryPrice: real price at which the open position was filled.
 *   - barsInPosition: how many cycles have elapsed since entry (PPO state).
 *   - lastSeenPosition: position observed in the previous cycle (entry/exit edge detection).
 *
 * Without this, a restart inside an open position resets entryPrice to the
 * current market price → stop-loss/take-profit anchor moves with the restart,
 * which can either realize unnecessary loss or exit a winner too early.
 */
export interface RuntimeState {
  entryPrice: number;
  barsInPosition: number;
  lastSeenPosition: number;
}

/**
 * Adapter: persists RuntimeState as a JSON file on disk. Read on startup,
 * written after every detectPosition() in the trading cycle (15-minute cadence
 * makes the I/O negligible).
 *
 * A missing or corrupt file is non-fatal: the caller can treat the absence
 * as "no prior state" and recover via fallback logic.
 */
export class RuntimeStateStore {
  constructor(
    private readonly filePath: string,
    private readonly logger: Logger
  ) {}

  /** Returns null if the file does not exist or cannot be parsed. */
  load(): RuntimeState | null {
    if (!fs.existsSync(this.filePath)) return null;
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<RuntimeState>;
      if (!this.isValid(parsed)) {
        this.logger.warn(`Runtime state file at ${this.filePath} is malformed — ignoring`);
        return null;
      }
      return parsed as RuntimeState;
    } catch (error) {
      this.logger.warn(`Failed to read runtime state from ${this.filePath}: ${String(error)}`);
      return null;
    }
  }

  save(state: RuntimeState): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(state), "utf8");
  }

  private isValid(value: Partial<RuntimeState>): value is RuntimeState {
    return typeof value.entryPrice === "number"
      && typeof value.barsInPosition === "number"
      && typeof value.lastSeenPosition === "number";
  }
}
