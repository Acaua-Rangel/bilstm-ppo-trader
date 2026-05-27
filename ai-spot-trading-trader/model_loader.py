import os
import numpy as np
import logging
from config import Config
import tensorflow as tf

logger = logging.getLogger(__name__)

class ModelLoader:
    def __init__(self):
        self.forecaster = None
        self.policy = None
        self._load_models()

    def _load_models(self):
        # Load forecaster
        for path in Config.MODEL_CANDIDATES:
            if not os.path.exists(path):
                continue
            try:
                self.forecaster = tf.keras.models.load_model(path)
                logger.info("Forecaster carregado de %s", path)
                break
            except Exception as e:
                logger.error("Falha ao carregar forecaster em %s: %s", path, e)
        
        if not self.forecaster:
            logger.warning("Nenhum modelo forecaster encontrado. A inferência falhará.")

        # Load policy
        for path in Config.POLICY_CANDIDATES:
            if not os.path.exists(path):
                continue
            try:
                self.policy = tf.keras.models.load_model(path)
                logger.info("Policy carregada de %s", path)
                break
            except Exception as e:
                logger.error("Falha ao carregar policy em %s: %s", path, e)

        if not self.policy:
            logger.warning("Nenhum modelo policy encontrado.")

    def _assemble_state(self, candle_info, position, bars_in_pos, pnl, forecast):
        # 13 features:
        # 1 - position, pnl, min(bars_in_pos / 100.0, 1.0),
        # (open_ - close) / close, (high - close) / close,
        # (low - close) / close, (high - low) / close,
        # position, volatility, *forecast[:4]
        
        c = candle_info['close']
        o = candle_info['open']
        h = candle_info['high']
        l = candle_info['low']
        
        return [
            1.0 - position,
            float(pnl),
            min(bars_in_pos / 100.0, 1.0),
            (o - c) / c,
            (h - c) / c,
            (l - c) / c,
            (h - l) / c,
            float(position),
            float(candle_info['volatility']),
            float(forecast[0]),
            float(forecast[1]),
            float(forecast[2]),
            float(forecast[3])
        ]

    def predict(self, features: np.ndarray, candle_info: dict) -> str:
        """
        Recebe o array de features e as informações do último candle para decidir a ação.
        """
        if self.forecaster is None or self.policy is None or features is None:
            return "HOLD"
        
        try:
            # 1. Obter predição contínua (soft labels) do Forecaster
            prediction = self.forecaster.predict(features, verbose=0)
            forecast = prediction[0]
            
            # 2. Simular Estado FLAT (position = 0, pnl = 0) -> Avaliar se devemos comprar
            state_flat = self._assemble_state(candle_info, position=0.0, bars_in_pos=0.0, pnl=0.0, forecast=forecast)
            state_flat_tensor = tf.convert_to_tensor([state_flat], dtype=tf.float32)
            action_probs_flat = self.policy.predict(state_flat_tensor, verbose=0)[0]
            action_flat = np.argmax(action_probs_flat)
            
            # 3. Simular Estado IN POSITION (position = 1, pnl = 0) -> Avaliar se devemos vender
            state_in = self._assemble_state(candle_info, position=1.0, bars_in_pos=10.0, pnl=0.0, forecast=forecast)
            state_in_tensor = tf.convert_to_tensor([state_in], dtype=tf.float32)
            action_probs_in = self.policy.predict(state_in_tensor, verbose=0)[0]
            action_in = np.argmax(action_probs_in)
            
            logger.debug("Probabilidades FLAT: HOLD=%.2f%%, BUY=%.2f%%, SELL=%.2f%%", 
                        action_probs_flat[0]*100, action_probs_flat[1]*100, action_probs_flat[2]*100)
            logger.debug("Probabilidades IN: HOLD=%.2f%%, BUY=%.2f%%, SELL=%.2f%%", 
                        action_probs_in[0]*100, action_probs_in[1]*100, action_probs_in[2]*100)
            
            # 0=HOLD, 1=BUY, 2=SELL
            # O Actor penalizou mercados laterais (ADX < 20) no treino de BUY, então ele fará isso naturalmente aqui.
            if action_flat == 1:
                return "BUY"
            elif action_in == 2:
                return "SELL"
            else:
                return "HOLD"
                
        except Exception as e:
            logger.error(f"Erro durante a predição do modelo (PPO): {e}")
            return "HOLD"
