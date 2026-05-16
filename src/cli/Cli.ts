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
    const modeName = args[0];
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

Usage: npm start <mode>
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
