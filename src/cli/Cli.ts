import { Container, Environment } from "./Container";
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
      ["test", new TestCommand(container)],
      ["invest", new InvestCommand(container)],
    ]);
  }

  async run(args: string[]): Promise<void> {
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

  test     Backtest on real Binance data (measures win rate, no money spent)
  invest   Apply REAL MONEY 24/7 (requires Binance credentials)

Flags:
  --device=auto|cpu|gpu   Choose TensorFlow backend (default: auto).
                          auto = GPU if available, else CPU.
                          Can also be set via TF_DEVICE env var.

Import pre-trained models from Kaggle:
  1. Run the notebook: https://www.kaggle.com/code/acaurangel/bilstm-ppo-self-attention-ai-spot-trading
  2. Download tfjs_models.zip from the Kaggle output panel.
  3. Extract the zip into ./models/

Usage:
  npm run test:strategy
  npm run test:strategy -- --device=cpu
  npm run invest
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
