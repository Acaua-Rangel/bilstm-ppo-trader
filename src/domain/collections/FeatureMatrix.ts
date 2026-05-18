/**
 * First-Class Collection: feature matrix [window × num_features].
 *
 * Backed by a flat Float32Array (row-major) rather than a number[][] to
 * keep memory predictable at scale. With the multi-symbol forecaster
 * dataset we hold ~200k of these in memory simultaneously; a nested
 * JS array of 64×10 floats costs ~10 KB per matrix due to V8 object
 * overhead, which puts us at ~2 GB before training even starts. A
 * Float32Array drops the same data to ~2.6 KB and is also what TF.js
 * wants when building tensor3d, so we avoid an extra conversion pass.
 */
export class FeatureMatrix {
  private constructor(
    private readonly buffer: Float32Array,
    private readonly rows: number,
    private readonly cols: number
  ) {}

  static fromRows(rows: ReadonlyArray<ReadonlyArray<number>>): FeatureMatrix {
    if (rows.length === 0) throw new Error("FeatureMatrix is empty");
    const cols = rows[0].length;
    const buffer = new Float32Array(rows.length * cols);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row.length !== cols) throw new Error("FeatureMatrix: ragged rows");
      buffer.set(row, i * cols);
    }
    return new FeatureMatrix(buffer, rows.length, cols);
  }

  static fromFlat(buffer: Float32Array, rows: number, cols: number): FeatureMatrix {
    if (buffer.length !== rows * cols) {
      throw new Error(`FeatureMatrix: buffer length ${buffer.length} != ${rows}*${cols}`);
    }
    if (rows === 0) throw new Error("FeatureMatrix is empty");
    return new FeatureMatrix(buffer, rows, cols);
  }

  windowSize(): number {
    return this.rows;
  }

  featuresPerStep(): number {
    return this.cols;
  }

  /**
   * Flat row-major view backed by the same buffer — DO NOT mutate.
   * Used by BiLSTMForecaster to copy directly into the tensor3d input
   * without going through a nested-array intermediate.
   */
  flatView(): Float32Array {
    return this.buffer;
  }
}
