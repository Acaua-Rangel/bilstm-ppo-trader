import os
import numpy as np
import logging
from config import Config

logger = logging.getLogger(__name__)

class ModelLoader:
    def __init__(self):
        self.model = None
        self._load_model()

    def _load_model(self):
        import tensorflow as tf

        for path in Config.MODEL_CANDIDATES:
            if not os.path.exists(path):
                continue
            try:
                self.model = tf.keras.models.load_model(path)
                logger.info("Modelo carregado de %s", path)
                return
            except Exception as e:
                logger.error("Falha ao carregar modelo em %s: %s", path, e)

        logger.warning(
            "Nenhum modelo encontrado. Locais testados: %s. A inferência retornará HOLD.",
            Config.MODEL_CANDIDATES,
        )

    def predict(self, features: np.ndarray) -> str:
        """
        Recebe o array de features (1, 128, 20) e retorna 'BUY', 'SELL' ou 'HOLD'.
        """
        if self.model is None or features is None:
            return "HOLD"
        
        try:
            # Predição retorna (1, horizon) com soft labels
            prediction = self.model.predict(features, verbose=0)
            
            # Pega a predição média do horizonte (horizon = 4)
            avg_pred = np.mean(prediction[0])
            
            # Thresholds ajustáveis baseados na calibração (0.02 a 0.98 do DatasetBuilder)
            # Acima de 0.65 = Tendência Forte de Alta (BUY)
            # Abaixo de 0.35 = Tendência Forte de Baixa (SELL)
            # Meio = HOLD
            if avg_pred > 0.65:
                return "BUY"
            elif avg_pred < 0.35:
                return "SELL"
            else:
                return "HOLD"
                
        except Exception as e:
            logger.error(f"Erro durante a predição do modelo: {e}")
            return "HOLD"
