import asyncio
import aiohttp
from aiohttp.resolver import ThreadedResolver
import ccxt.async_support as ccxt
import numpy as np
import pywt
import logging
from config import Config

logger = logging.getLogger(__name__)

# Mirrors oficiais da Binance — se o principal cair ou bloquear, tentamos os alternativos.
_BINANCE_HOSTS = [
    'api.binance.com',
    'api1.binance.com',
    'api2.binance.com',
    'api3.binance.com',
    'api4.binance.com',
]
_MAX_RETRIES_PER_HOST = 3


class DataProcessor:
    def __init__(self):
        self._host_idx = 0
        self.exchange = self._make_exchange(_BINANCE_HOSTS[0])

    def _make_exchange(self, host: str):
        ex = ccxt.binance({'enableRateLimit': True})
        # Reescreve cada URL pública/privada para apontar para o host escolhido.
        for key, url in list(ex.urls['api'].items()):
            if isinstance(url, str) and 'api.binance.com' in url:
                ex.urls['api'][key] = url.replace('api.binance.com', host)
        # aiodns falha no Windows ("Could not contact DNS servers") em configs com múltiplas
        # interfaces de rede (VPN, WSL, etc). Forçamos ThreadedResolver, que delega ao
        # getaddrinfo do sistema — mesmo resolver que o PowerShell usa com sucesso.
        connector = aiohttp.TCPConnector(resolver=ThreadedResolver(), ssl=True)
        ex.session = aiohttp.ClientSession(connector=connector, trust_env=True)
        return ex

    async def _swap_host(self):
        """Fecha o client atual e instancia um novo apontando para o próximo mirror."""
        try:
            await self.exchange.close()
        except Exception:
            pass
        self._host_idx = (self._host_idx + 1) % len(_BINANCE_HOSTS)
        new_host = _BINANCE_HOSTS[self._host_idx]
        logger.warning("Trocando para host alternativo da Binance: %s", new_host)
        self.exchange = self._make_exchange(new_host)

    async def fetch_recent_candles(self) -> np.ndarray:
        """
        Busca a janela necessária de K-lines. Para calcular indicadores como
        EMA21, VWAP96 e Wavelets(128), precisamos de pelo menos ~250 candles.
        Buscaremos 300 candles. Retry com backoff exponencial + fallback de hosts.
        """
        limit = 300
        last_err: Exception | None = None

        for host_attempt in range(len(_BINANCE_HOSTS)):
            current_host = _BINANCE_HOSTS[self._host_idx]
            for retry in range(_MAX_RETRIES_PER_HOST):
                try:
                    raw_candles = await self.exchange.fetch_ohlcv(
                        Config.TRADING_SYMBOL, Config.TIMEFRAME, limit=limit
                    )
                    if not raw_candles or len(raw_candles) < Config.WINDOW_SIZE + 100:
                        logger.error("Não há candles suficientes retornados pela API.")
                        return None
                    # Format: [ts, open, high, low, close, volume]
                    return np.array(raw_candles, dtype=np.float64)
                except Exception as e:
                    last_err = e
                    delay = 2 ** retry  # 1s, 2s, 4s
                    logger.warning(
                        "Falha ao buscar candles em %s (tentativa %d/%d): %s: %s. Aguardando %ds.",
                        current_host, retry + 1, _MAX_RETRIES_PER_HOST,
                        type(e).__name__, e, delay,
                    )
                    if retry < _MAX_RETRIES_PER_HOST - 1:
                        await asyncio.sleep(delay)

            # Esgotou retries neste host — troca para o próximo mirror.
            if host_attempt < len(_BINANCE_HOSTS) - 1:
                await self._swap_host()

        logger.error("Todos os hosts da Binance falharam.", exc_info=last_err)
        return None

    async def close(self):
        try:
            await self.exchange.close()
        except Exception:
            pass

    # ---- Funções Replicadas do Dataset Kaggle ----
    def ema(self, values: np.ndarray, period: int) -> np.ndarray:
        """EMA tolerante a NaN no início da série (necessário para encadear
        indicadores cujas saídas têm NaN de aquecimento, como dx → adx)."""
        alpha = 2.0 / (period + 1)
        result = np.full(len(values), np.nan)

        # Pula NaN iniciais para encontrar a primeira janela utilizável.
        first_valid = 0
        while first_valid < len(values) and np.isnan(values[first_valid]):
            first_valid += 1

        seed_end = first_valid + period
        if seed_end > len(values):
            return result

        seed_window = values[first_valid:seed_end]
        if np.any(np.isnan(seed_window)):
            # NaN no meio da janela de seed — não dá pra iniciar com confiança.
            return result

        result[seed_end - 1] = np.mean(seed_window)
        for i in range(seed_end, len(values)):
            if np.isnan(values[i]):
                result[i] = result[i - 1]
            else:
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
        
        current_close = closes[w_end - 1]
        current_adx = adx_all[w_end - 1]
        if np.isnan(current_adx):
            current_adx = None
        else:
            current_adx = float(current_adx)

        # Calculo de volatilidade do último candle (20 periods)
        vol_start = max(1, i - 20)
        rets = (closes[vol_start:i+1] - closes[vol_start-1:i]) / closes[vol_start-1:i]
        current_vol = np.std(rets) if len(rets) > 0 else 0.0

        candle_info = {
            'open': opens[i],
            'high': highs[i],
            'low': lows[i],
            'close': closes[i],
            'volatility': current_vol,
            'adx': current_adx
        }

        return X, current_close, candle_info
