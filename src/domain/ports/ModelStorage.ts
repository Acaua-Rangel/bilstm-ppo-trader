/**
 * Port: persistence of trained models.
 */
export interface ModelStorage {
  loadForecastModel(path: string): Promise<void>;
  loadAgent(path: string): Promise<void>;
}
