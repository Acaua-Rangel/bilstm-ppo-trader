import DiscreteWavelets from "discrete-wavelets";

const WAVELET_NAME = "db4" as const;
const WAVELET_LEVEL = 2;
const SLOPE_WINDOW = 10;
const ENERGY_WINDOW = 20;
const ENTROPY_WINDOW = 32;

/**
 * Service: replicates the wavelet feature pipeline used at training time
 * (notebook: bilstm-ppo-self-attention-ai-spot-trading.ipynb).
 *
 * Mirrors PyWavelets behaviour: edge-padded to next power of 2, multilevel
 * db4 DWT (level 2), each band reconstructed at full resolution by zeroing
 * out the other coefficient arrays.
 *
 * Output bands and rolling statistics are aligned 1:1 with the input
 * `closes`, so callers can index any timestep j into the returned arrays
 * to pull the corresponding feature.
 */
export class WaveletFeatures {
  static compute(closes: ReadonlyArray<number>): WaveletBands {
    const n = closes.length;
    const padLen = nextPowerOfTwo(n);
    const padded = edgePad(closes, padLen);

    const coeffs = DiscreteWavelets.wavedec(padded, WAVELET_NAME, "symmetric", WAVELET_LEVEL) as number[][];
    const trend = reconstructBand(coeffs, 0).slice(0, n);
    const medium = reconstructBand(coeffs, 1).slice(0, n);
    const high = reconstructBand(coeffs, coeffs.length - 1).slice(0, n);

    const slope = rollingSlope(trend, SLOPE_WINDOW);
    const mediumEnergy = rollingEnergy(medium, ENERGY_WINDOW);
    const highEnergy = rollingEnergy(high, ENERGY_WINDOW);
    const entropy = rollingSpectralEntropy(closes, ENTROPY_WINDOW);

    return { trend, medium, high, slope, mediumEnergy, highEnergy, entropy };
  }
}

export interface WaveletBands {
  trend: ReadonlyArray<number>;
  medium: ReadonlyArray<number>;
  high: ReadonlyArray<number>;
  slope: ReadonlyArray<number>;
  mediumEnergy: ReadonlyArray<number>;
  highEnergy: ReadonlyArray<number>;
  entropy: ReadonlyArray<number>;
}

function reconstructBand(coeffs: number[][], keepIndex: number): number[] {
  const masked = coeffs.map((arr, i) =>
    i === keepIndex ? arr.slice() : new Array<number>(arr.length).fill(0)
  );
  return DiscreteWavelets.waverec(masked, WAVELET_NAME) as number[];
}

function nextPowerOfTwo(n: number): number {
  return 1 << Math.ceil(Math.log2(Math.max(n, 1)));
}

function edgePad(values: ReadonlyArray<number>, targetLen: number): number[] {
  const padded = values.slice() as number[];
  const edge = values[values.length - 1] ?? 0;
  while (padded.length < targetLen) padded.push(edge);
  return padded;
}

function rollingEnergy(detail: ReadonlyArray<number>, window: number): number[] {
  const out = new Array<number>(detail.length).fill(0);
  for (let i = window; i < detail.length; i++) {
    let sumSq = 0;
    for (let k = i - window; k < i; k++) sumSq += detail[k] ** 2;
    out[i] = sumSq / window;
  }
  return out;
}

/**
 * Linear-regression slope (degree-1 polyfit) of the last `window` values.
 * Matches np.polyfit(x, segment, 1)[0] with x = [0..window-1].
 */
function rollingSlope(values: ReadonlyArray<number>, window: number): number[] {
  const out = new Array<number>(values.length).fill(0);
  const sumX = (window - 1) * window / 2;
  const sumXX = (window - 1) * window * (2 * window - 1) / 6;
  const denom = window * sumXX - sumX * sumX;
  if (denom === 0) return out;
  for (let i = window; i < values.length; i++) {
    let sumY = 0;
    let sumXY = 0;
    for (let k = 0; k < window; k++) {
      const y = values[i - window + k];
      sumY += y;
      sumXY += k * y;
    }
    out[i] = (window * sumXY - sumX * sumY) / denom;
  }
  return out;
}

/**
 * Normalized rolling spectral entropy: 0 = single-frequency signal,
 * 1 = white-noise-like. Computed via real DFT over each window of size 32,
 * mean-detrended to match np.fft.rfft(segment - mean(segment)).
 */
function rollingSpectralEntropy(closes: ReadonlyArray<number>, window: number): number[] {
  const out = new Array<number>(closes.length).fill(0);
  const bins = Math.floor(window / 2) + 1;
  const maxEntropy = Math.log2(bins);
  if (maxEntropy === 0) return out;
  for (let i = window; i < closes.length; i++) {
    const psdNorm = realPsdNormalized(closes, i - window, window);
    let entropy = 0;
    for (const p of psdNorm) entropy -= p * Math.log2(p + 1e-12);
    out[i] = entropy / maxEntropy;
  }
  return out;
}

function realPsdNormalized(values: ReadonlyArray<number>, start: number, window: number): number[] {
  let mean = 0;
  for (let k = 0; k < window; k++) mean += values[start + k];
  mean /= window;

  const bins = Math.floor(window / 2) + 1;
  const psd = new Array<number>(bins);
  let total = 0;
  for (let k = 0; k < bins; k++) {
    let re = 0;
    let im = 0;
    const angularStep = (-2 * Math.PI * k) / window;
    for (let n = 0; n < window; n++) {
      const x = values[start + n] - mean;
      const theta = angularStep * n;
      re += x * Math.cos(theta);
      im += x * Math.sin(theta);
    }
    psd[k] = re * re + im * im;
    total += psd[k];
  }
  const inv = 1 / (total + 1e-12);
  for (let k = 0; k < bins; k++) psd[k] *= inv;
  return psd;
}
