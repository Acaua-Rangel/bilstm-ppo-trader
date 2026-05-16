import { Container, Environment } from "./Container";
import { TrainCommand } from "./commands/TrainCommand";
import { TestCommand } from "./commands/TestCommand";
import { InvestCommand } from "./commands/InvestCommand";

/**
 * CLI entry point. Dispatches to the correct command.
 * Open/Closed: new commands can be added without changing this code,
 * just by registering them in the map.
 */
export class Cli {
  private readonly commands: Map<string, Command>;

  constructor(env: Environment) {
    const container = new Container(env);
    this.commands = new Map<string, Command>([
      ["train", new TrainCommand(container)],
      ["test", new TestCommand(container)],
      ["invest", new InvestCommand(container)],
    ]);
  }

  async run(args: string[]): Promise<void> {
    // Filter out --flag args (e.g. --device=gpu) so they don't get parsed as a mode.
    // Flags are read directly by their consumers (e.g. tf.ts reads --device).
    const positional = args.filter(a => !a.startsWith("--"));
    const modeName = positional[0];
    if (!modeName) return this.printUsage();
    const command = this.commands.get(modeName);
    if (!command) return this.printUnknown(modeName);
    await command.execute();
  }

  private printUsage(): void {
    console.log(`
AI Trading Bot — available modes:

  train    Train forecast model + RL agent with historical data
  test     Backtest on real Binance data (measures win rate, no money spent)
  invest   Apply REAL MONEY 24/7 (requires Binance credentials)

Flags:
  --device=auto|cpu|gpu   Choose TensorFlow backend (default: auto).
                          auto = GPU if available, else CPU.
                          Can also be set via TF_DEVICE env var.

Usage:
  npm run train
  npm run train -- --device=gpu
  npm run test:strategy -- --device=cpu
    `);
  }

  private printUnknown(modeName: string): void {
    console.error(`Unknown mode: ${modeName}`);
    this.printUsage();
  }
}

export interface Command {
  execute(): Promise<void>;
}
