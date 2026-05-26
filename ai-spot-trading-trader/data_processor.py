import ccxt.async_support as ccxt
import numpy as np
import pywt
import logging
from config import Config

logger = logging.getLogger(__name__)

class DataProcessor:
    def __init__(self):
        self.exchange = ccxt.binance({'enableRateLimit': True})
    
    async def fetch_recent_candles(self) -> np.ndarray:
        """
        Busca a janela necessária de K-lines. Para calcular indicadores como
        EMA21, VWAP96 e Wavelets(128), precisamos de pelo menos ~250 candles.
        Buscaremos 300 candles.
        """
        limit = 300
        try:
            raw_candles = await self.exchange.fetch_ohlcv(Config.TRADING_SYMBOL, Config.TIMEFRAME, limit=limit)
            if not raw_candles or len(raw_candles) < Config.WINDOW_SIZE + 100:
                logger.error("Não há candles suficientes retornados pela API.")
                return None
            
            # Format: [ts, open, high, low, close, volume]
            arr = np.array(raw_candles, dtype=np.float64)
            return arr
        except Exception as e:
            logger.error(f"Erro ao buscar K-Lines: {e}")
            return None
        finally:
            await self.exchange.close()

    # ---- Funções Replicadas do Dataset Kaggle ----
    def ema(self, values: np.ndarray, period: int) -> np.ndarray:
        alpha = 2.0 / (period + 1)
        result = np.full(len(values), np.nan)
        if len(values) < period: return result
        result[period - 1] = np.mean(values[:period])
        for i in range(period, len(values)):
            result[i] = values[i] * alpha + result[i - 1] * (1 - alpha)
        return result

    def rsi(self, values: np.ndarray, period: int = 14) -> np.ndarray:
        deltas = np.diff(values)
        result = np.full(len(values), np.nan)
        if len(deltas) < period: return result
        gains = np.where(deltas > 0, deltas, 0.0)
        losses = np.where(deltas < 0, -deltas, 0.0)
        avg_g, avg_l = np.mean(gains[:period]), np.mean(losses[:period])
        rs = avg_g / (avg_l + 1e-10)
        result[period] = 100 - 100 / (1 + rs)
        for i in range(period, len(deltas)):
            avg_g = (avg_g * (period - 1) + gains[i]) / period
            avg_l = (avg_l * (period - 1) + losses[i]) / period
            rs = avg_g / (avg_l + 1e-10)
            result[i + 1] = 100 - 100 / (1 + rs)
        return result

    def macd(self, values: np.ndarray, fast=12, slow=26, signal=9):
        fast_ema = self.ema(values, fast)
        slow_ema = self.ema(values, slow)
        macd_line = fast_ema - slow_ema
        signal_line = self.ema(np.where(np.isnan(macd_line), 0, macd_line), signal)
        return macd_line, signal_line

    def bollinger(self, values: np.ndarray, period: int = 20, std_dev: float = 2.0):
        upper = np.full(len(values), np.nan)
        lower = np.full(len(values), np.nan)
        for i in range(period - 1, len(values)):
            window = values[i - period + 1 : i + 1]
            m = np.mean(window)
            s = np.std(window, ddof=0)
            upper[i] = m + std_dev * s
            lower[i] = m - std_dev * s
        return upper, lower

    def rolling_vwap(self, highs: np.ndarray, lows: np.ndarray, closes: np.ndarray, volumes: np.ndarray, period: int = 96) -> np.ndarray:
        typical_price = (highs + lows + closes) / 3.0
        pv = typical_price * volumes
        vwap = np.full(len(closes), np.nan)
        if len(closes) < period: return vwap
        sum_pv = np.sum(pv[:period])
        sum_v = np.sum(volumes[:period])
        vwap[period - 1] = sum_pv / (sum_v + 1e-10)
        for i in range(period, len(closes)):
            sum_pv += pv[i] - pv[i - period]
            sum_v += volumes[i] - volumes[i - period]
            vwap[i] = sum_pv / (sum_v + 1e-10)
        return vwap

    def obv(self, closes: np.ndarray, volumes: np.ndarray) -> np.ndarray:
        res = np.zeros(len(closes))
        res[0] = volumes[0]
        for i in range(1, len(closes)):
            if closes[i] > closes[i-1]:
                res[i] = res[i-1] + volumes[i]
            elif closes[i] < closes[i-1]:
                res[i] = res[i-1] - volumes[i]
            else:
                res[i] = res[i-1]
        return res

    def sma(self, values: np.ndarray, period: int) -> np.ndarray:
        res = np.full(len(values), np.nan)
        if len(values) < period: return res
        window_sum = np.sum(values[:period])
        res[period - 1] = window_sum / period
        for i in range(period, len(values)):
            window_sum += values[i] - values[i - period]
            res[i] = window_sum / period
        return res

    def adx_approximation(self, highs: np.ndarray, lows: np.ndarray, closes: np.ndarray, period: int = 14) -> np.ndarray:
        up_move = np.diff(highs)
        down_move = np.diff(lows) * -1
        plus_dm = np.where((up_move > down_move) & (up_move > 0), up_move, 0.0)
        minus_dm = np.where((down_move > up_move) & (down_move > 0), down_move, 0.0)
        tr1 = highs[1:] - lows[1:]
        tr2 = np.abs(highs[1:] - closes[:-1])
        tr3 = np.abs(lows[1:] - closes[:-1])
        tr = np.maximum(tr1, np.maximum(tr2, tr3))
        atr = self.ema(tr, period)
        plus_di = 100 * (self.ema(plus_dm, period) / (atr + 1e-10))
        minus_di = 100 * (self.ema(minus_dm, period) / (atr + 1e-10))
        dx = 100 * np.abs(plus_di - minus_di) / (plus_di + minus_di + 1e-10)
        adx = self.ema(dx, period)
        return np.concatenate(([np.nan], adx))

    def wavelet_decompose_series(self, closes: np.ndarray) -> dict:
        WAVELET_NAME = 'db4'
        WAVELET_LEVEL = 2
        n = len(closes)
        pad_len = int(2 ** np.ceil(np.log2(n)))
        padded = np.pad(closes, (0, pad_len - n), mode='edge')
        coeffs = pywt.wavedec(padded, WAVELET_NAME, level=WAVELET_LEVEL)
        trend_coeffs = [coeffs[0]] + [np.zeros_like(c) for c in coeffs[1:]]
        trend = pywt.waverec(trend_coeffs, WAVELET_NAME)[:n]
        med_coeffs = [np.zeros_like(coeffs[0]), coeffs[1]] + [np.zeros_like(c) for c in coeffs[2:]]
        medium = pywt.waverec(med_coeffs, WAVELET_NAME)[:n]
        high_coeffs = [np.zeros_like(coeffs[0])] + [np.zeros_like(c) for c in coeffs[1:-1]] + [coeffs[-1]]
        high = pywt.waverec(high_coeffs, WAVELET_NAME)[:n]
        return {'trend': trend, 'medium': medium, 'high': high}

    def wavelet_energy_ratio(self, detail: np.ndarray, window: int = 20) -> np.ndarray:
        energy = np.zeros(len(detail))
        for i in range(window, len(detail)):
            segment = detail[i - window : i]
            energy[i] = np.mean(segment ** 2)
        return energy

    def wavelet_trend_slope(self, trend: np.ndarray, window: int = 10) -> np.ndarray:
        slope = np.zeros(len(trend))
        for i in range(window, len(trend)):
            segment = trend[i - window : i]
            x = np.arange(window)
            slope[i] = np.polyfit(x, segment, 1)[0]
        return slope

    def spectral_entropy_rolling(self, closes: np.ndarray, window: int = 32) -> np.ndarray:
        entropy = np.zeros(len(closes))
        for i in range(window, len(closes)):
            segment = closes[i - window : i]
            fft_amp = np.abs(np.fft.rfft(segment - np.mean(segment)))
            psd = fft_amp ** 2
            psd_norm = psd / (np.sum(psd) + 1e-12)
            entropy[i] = -np.sum(psd_norm * np.log2(psd_norm + 1e-12))
        max_ent = np.log2(window // 2 + 1)
        entropy = entropy / max_ent
        return entropy

    async def get_latest_features(self) -> np.ndarray:
        """
        Retorna (1, 128, 20) correspondente a janela do momento atual.
        """
        candles = await self.fetch_recent_candles()
        if candles is None:
            return None
            
        closes  = candles[:, 4]
        opens   = candles[:, 1]
        highs   = candles[:, 2]
        lows    = candles[:, 3]
        volumes = candles[:, 5]

        # Calculo de indicadores com o array inteiro
        ema9_all   = self.ema(closes, 9)
        ema21_all  = self.ema(closes, 21)
        rsi14_all  = self.rsi(closes, 14)
        macd_line, _ = self.macd(closes, 12, 26, 9)
        bb_upper, bb_lower = self.bollinger(closes, 20, 2.0)
        sp_entropy = self.spectral_entropy_rolling(closes, window=32)
        adx_all = self.adx_approximation(highs, lows, closes, 14)

        vwap_all = self.rolling_vwap(highs, lows, closes, volumes, 96)
        obv_all  = self.obv(closes, volumes)
        obv_ema  = self.ema(obv_all, 21)
        vol_sma  = self.sma(volumes, 20)

        window_size = Config.WINDOW_SIZE
        # O indice atual (último) para construir as features
        i = len(candles) - 1
        w_start = i - window_size + 1
        w_end   = i + 1

        ref_close  = closes[w_start]
        max_volume = np.max(volumes[w_start:w_end]) if np.max(volumes[w_start:w_end]) > 0 else 1.0
        
        window_closes = closes[w_start:w_end]
        wv = self.wavelet_decompose_series(window_closes)
        wv_trend   = wv['trend']
        wv_medium  = wv['medium']
        wv_high    = wv['high']
        wv_slope   = self.wavelet_trend_slope(wv_trend, window=10)
        wv_med_nrg = self.wavelet_energy_ratio(wv_medium, window=20)
        wv_hi_nrg  = self.wavelet_energy_ratio(wv_high, window=20)
        slope_std = np.std(wv_slope) + 1e-10

        rows = []
        for j in range(w_start, w_end):
            local_j = j - w_start
            c = closes[j]
            prev_ret = 0.0 if j == w_start else (c - closes[j-1]) / closes[j-1]
            
            r9   = ema9_all[j]   if not np.isnan(ema9_all[j])   else c
            r21  = ema21_all[j]  if not np.isnan(ema21_all[j])  else c
            rsi_v = rsi14_all[j] if not np.isnan(rsi14_all[j])  else 50.0
            macd_v = macd_line[j] if not np.isnan(macd_line[j]) else 0.0
            bbu  = bb_upper[j]   if not np.isnan(bb_upper[j])   else c
            bbl  = bb_lower[j]   if not np.isnan(bb_lower[j])   else c
            adx_val = adx_all[j] if not np.isnan(adx_all[j])    else 20.0
            
            vwp = vwap_all[j] if not np.isnan(vwap_all[j]) else c
            vsma = vol_sma[j] if not np.isnan(vol_sma[j]) else (volumes[j] + 1e-8)
            oe21 = obv_ema[j] if not np.isnan(obv_ema[j]) else obv_all[j]

            med_e = wv_med_nrg[local_j] if wv_med_nrg[local_j] > 0 else 1e-6
            hi_e  = wv_hi_nrg[local_j]  if wv_hi_nrg[local_j] > 0  else 0.0
            noise_to_signal = float(np.clip(hi_e / med_e, 0.0, 10.0))

            vwap_dist = (c - vwp) / vwp
            rel_vol = volumes[j] / (vsma + 1e-8)
            obv_oscillator = (obv_all[j] - oe21) / (vsma + 1e-8)

            rows.append([
                c / ref_close - 1,               
                volumes[j] / max_volume,         
                rsi_v / 100.0,                   
                macd_v / c,                      
                prev_ret,                        
                (highs[j] - lows[j]) / c,        
                (r9 - c) / c,                    
                (r21 - c) / c,                   
                (bbu - c) / c,                   
                (bbl - c) / c,                   
                (wv_trend[local_j] - c) / c,     
                wv_medium[local_j] / c,          
                wv_high[local_j] / c,            
                wv_slope[local_j] / slope_std,   
                noise_to_signal,                 
                sp_entropy[j],                   
                vwap_dist,                       
                rel_vol,                         
                obv_oscillator,                  
                adx_val / 100.0,                 
            ])

        X = np.array([rows], dtype=np.float32)
        # Returns current close price alongside features for PnL calculation
        current_close = closes[w_end - 1]
        return X, current_close
