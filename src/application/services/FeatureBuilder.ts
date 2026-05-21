import { CandleSeries } from "../../domain/collections/CandleSeries";
import { FeatureMatrix } from "../../domain/collections/FeatureMatrix";
import { EMA, RSI, MACD, BollingerBands } from "technicalindicators";
import { WaveletFeatures, WaveletBands } from "./WaveletFeatures";

/**
 * Service: builds 16-feature windows for the BiLSTM.
 * Layout (per timestep):
 *   0-9   original indicators (price, volume, RSI, MACD, range, EMA/BB distances)
 *   10-15 wavelet dual-path features (db4 level-2: trend, medium, high, slope,
 *         energy ratio, spectral entropy)
 *
 * Must match the feature pipeline in
 * notebooks/bilstm-ppo-self-attention-ai-spot-trading.ipynb exactly.
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
    const indicators = this.computeIndicators(series);
    const wavelet = WaveletFeatures.compute([...series.closes()]);
    const seriesSize = series.size();
    const windowStart = seriesSize - this.windowSize;
    const lastWindow = series.lastN(this.windowSize);
    const slopeStd = stdOfSlice(wavelet.slope, windowStart, this.windowSize);
    const rows = this.buildRows(lastWindow, indicators, wavelet, windowStart, slopeStd);
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

  private buildRows(
    window: CandleSeries,
    ind: IndicatorBundle,
    wavelet: WaveletBands,
    windowStart: number,
    slopeStd: number
  ): number[][] {
    const rows: number[][] = [];
    const referenceClose = window.at(0).closePrice().toNumber();
    const maxVolume = Math.max(...window.volumes());
    for (let i = 0; i < window.size(); i++) {
      rows.push(this.buildRow(window, i, ind, wavelet, windowStart, referenceClose, maxVolume, slopeStd));
    }
    return rows;
  }

  private buildRow(
    window: CandleSeries,
    i: number,
    ind: IndicatorBundle,
    wavelet: WaveletBands,
    windowStart: number,
    reference: number,
    maxVolume: number,
    slopeStd: number
  ): number[] {
    const candle = window.at(i);
    const close = candle.closePrice().toNumber();
    const indIdx = ind.ema9.length - window.size() + i;
    const seriesIdx = windowStart + i;
    const medEnergy = wavelet.mediumEnergy[seriesIdx];
    const safeMedEnergy = medEnergy > 0 ? medEnergy : 1e-10;
    const hiEnergy = wavelet.highEnergy[seriesIdx] > 0 ? wavelet.highEnergy[seriesIdx] : 0;
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
      (wavelet.trend[seriesIdx] - close) / close,
      wavelet.medium[seriesIdx] / close,
      wavelet.high[seriesIdx] / close,
      wavelet.slope[seriesIdx] / slopeStd,
      hiEnergy / (safeMedEnergy + 1e-10),
      wavelet.entropy[seriesIdx],
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

function stdOfSlice(values: ReadonlyArray<number>, start: number, length: number): number {
  let mean = 0;
  for (let k = 0; k < length; k++) mean += values[start + k];
  mean /= length;
  let sq = 0;
  for (let k = 0; k < length; k++) {
    const d = values[start + k] - mean;
    sq += d * d;
  }
  return Math.sqrt(sq / length) + 1e-10;
}
