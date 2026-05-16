/**
 * Port: persistence of trained models.
 */
export interface ModelStorage {
  saveForecastModel(path: string): Promise<void>;
  loadForecastModel(path: string): Promise<void>;
  saveAgent(path: string): Promise<void>;
  loadAgent(path: string): Promise<void>;
}
