/**
 * First-Class Collection: feature matrix [window × num_features].
 */
export class FeatureMatrix {
  constructor(private readonly data: ReadonlyArray<ReadonlyArray<number>>) {
    if (data.length === 0) throw new Error("FeatureMatrix is empty");
  }

  windowSize(): number {
    return this.data.length;
  }

  featuresPerStep(): number {
    return this.data[0].length;
  }

  toRawArray(): number[][] {
    return this.data.map(row => [...row]);
  }
}
