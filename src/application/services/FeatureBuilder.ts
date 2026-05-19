import { CandleSeries } from "../../domain/collections/CandleSeries";
import { FeatureMatrix } from "../../domain/collections/FeatureMatrix";
import { EMA, RSI, MACD, BollingerBands } from "technicalindicators";

/**
 * Service: builds features for the model.
 * SRP: only responsible for data-to-feature transformation.
 */
export class FeatureBuilder {
  private readonly windowSize: number;

  constructor(windowSize: number = 128) {
    this.windowSize = windowSize;
  }

  getWindowSize(): number {
    return this.windowSize;
  }

  build(series: CandleSeries): FeatureMatrix {
    const lastWindow = series.lastN(this.windowSize);
    const indicators = this.computeIndicators(series);
    const rows = this.buildRows(lastWindow, indicators);
    return FeatureMatrix.fromRows(rows);
  }

  private computeIndicators(series: CandleSeries): IndicatorBundle {
    const closes = [...series.closes()];
    return {
      ema9: EMA.calculate({ period: 9, values: closes }),
      ema21: EMA.calculate({ period: 21, values: closes }),
      rsi14: RSI.calculate({ period: 14, values: closes }),
      macd: MACD.calculate({
        values: closes, fastPeriod: 12, slowPeriod: 26,
        signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false,
      }),
      bb: BollingerBands.calculate({ period: 20, values: closes, stdDev: 2 }),
    };
  }

  private buildRows(window: CandleSeries, ind: IndicatorBundle): number[][] {
    const rows: number[][] = [];
    const referenceClose = window.at(0).closePrice().toNumber();
    const maxVolume = Math.max(...window.volumes());
    for (let i = 0; i < window.size(); i++) {
      rows.push(this.buildRow(window, i, ind, referenceClose, maxVolume));
    }
    return rows;
  }

  private buildRow(
    window: CandleSeries,
    i: number,
    ind: IndicatorBundle,
    reference: number,
    maxVolume: number
  ): number[] {
    const candle = window.at(i);
    const close = candle.closePrice().toNumber();
    const indIdx = ind.ema9.length - window.size() + i;
    return [
      close / reference - 1,
      candle.volumeAmount() / Math.max(maxVolume, 1),
      (ind.rsi14[indIdx] ?? 50) / 100,
      ((ind.macd[indIdx]?.MACD ?? 0)) / close,
      this.returnFromPrevious(window, i),
      candle.range() / close,
      ((ind.ema9[indIdx] ?? close) - close) / close,
      ((ind.ema21[indIdx] ?? close) - close) / close,
      ((ind.bb[indIdx]?.upper ?? close) - close) / close,
      ((ind.bb[indIdx]?.lower ?? close) - close) / close,
    ];
  }

  private returnFromPrevious(window: CandleSeries, i: number): number {
    if (i === 0) return 0;
    const previousClose = window.at(i - 1).closePrice().toNumber();
    const currentClose = window.at(i).closePrice().toNumber();
    return (currentClose - previousClose) / previousClose;
  }
}

interface IndicatorBundle {
  ema9: number[];
  ema21: number[];
  rsi14: number[];
  macd: Array<{ MACD?: number; signal?: number }>;
  bb: Array<{ upper: number; lower: number }>;
}
