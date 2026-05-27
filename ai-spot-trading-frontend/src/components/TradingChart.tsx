import { useEffect, useRef, useState } from 'react';
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  LineSeries,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { api } from '../api/client';
import type { Kline, TradeDecision } from '../api/client';
import { Loader2, RefreshCw } from 'lucide-react';

interface Props {
  hours?: number;
  interval?: string;
  symbol?: string;
}

const COLORS = {
  bg: 'transparent',
  text: '#a0a8b0',
  grid: 'rgba(255,255,255,0.04)',
  border: 'rgba(255,255,255,0.08)',
  up: '#71c829',
  down: '#ef4444',
  adx: '#f0b90b',
  buy: '#71c829',
  sell: '#ef4444',
  hold: '#94a3b8',
};

export const TradingChart = ({ hours = 24, interval = '15m', symbol = 'BTCFDUSD' }: Props) => {
  const priceContainerRef = useRef<HTMLDivElement>(null);
  const adxContainerRef = useRef<HTMLDivElement>(null);
  const priceChartRef = useRef<IChartApi | null>(null);
  const adxChartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const adxSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trades, setTrades] = useState<TradeDecision[]>([]);
  const [adxTooltip, setAdxTooltip] = useState<{ x: number; y: number } | null>(null);

  // Inicializa os charts uma vez
  useEffect(() => {
    if (!priceContainerRef.current || !adxContainerRef.current) return;

    // minimumWidth fixo garante que os dois charts reservem o mesmo espaço para o
    // eixo de preço à direita — sem isso, os ticks do tempo desalinham verticalmente.
    const PRICE_SCALE_MIN_WIDTH = 70;

    const common = {
      layout: { background: { color: 'transparent' as const }, textColor: COLORS.text, fontFamily: 'Geist, sans-serif' },
      grid: { vertLines: { color: COLORS.grid }, horzLines: { color: COLORS.grid } },
      rightPriceScale: { borderColor: COLORS.border, minimumWidth: PRICE_SCALE_MIN_WIDTH },
      timeScale: { borderColor: COLORS.border, timeVisible: true, secondsVisible: false },
      crosshair: { mode: CrosshairMode.Normal },
    };

    const priceChart = createChart(priceContainerRef.current, {
      ...common,
      height: 380,
      width: priceContainerRef.current.clientWidth,
    });
    const candle = priceChart.addSeries(CandlestickSeries, {
      upColor: COLORS.up,
      downColor: COLORS.down,
      borderVisible: false,
      wickUpColor: COLORS.up,
      wickDownColor: COLORS.down,
    });
    priceChartRef.current = priceChart;
    candleSeriesRef.current = candle;
    markersRef.current = createSeriesMarkers(candle, []);

    const adxChart = createChart(adxContainerRef.current, {
      ...common,
      height: 130,
      width: adxContainerRef.current.clientWidth,
      timeScale: { ...common.timeScale, visible: true },
    });
    const adxLine = adxChart.addSeries(LineSeries, {
      color: COLORS.adx,
      lineWidth: 2,
      priceLineVisible: false,
    });
    adxChartRef.current = adxChart;
    adxSeriesRef.current = adxLine;

    // Linha de referência em ADX=20: limiar mínimo no qual o modelo foi treinado a operar.
    adxLine.createPriceLine({
      price: 20,
      color: 'rgba(241, 191, 11, 0.6)',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: 'min 20',
    });

    // Detecta hover próximo da linha do 20 → mostra tooltip explicando o limiar.
    adxChart.subscribeCrosshairMove((param) => {
      if (!param.point || param.point.y === undefined) {
        setAdxTooltip(null);
        return;
      }
      const yOf20 = adxLine.priceToCoordinate(20);
      if (yOf20 === null || yOf20 === undefined) {
        setAdxTooltip(null);
        return;
      }
      if (Math.abs(param.point.y - yOf20) < 6) {
        setAdxTooltip({ x: param.point.x, y: yOf20 });
      } else {
        setAdxTooltip(null);
      }
    });

    // Sincroniza os eixos de tempo dos dois gráficos
    const sync = (source: IChartApi, target: IChartApi) => {
      source.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (range) target.timeScale().setVisibleLogicalRange(range);
      });
    };
    sync(priceChart, adxChart);
    sync(adxChart, priceChart);

    const resize = () => {
      if (priceContainerRef.current) priceChart.resize(priceContainerRef.current.clientWidth, 380);
      if (adxContainerRef.current) adxChart.resize(adxContainerRef.current.clientWidth, 130);
    };
    window.addEventListener('resize', resize);

    return () => {
      window.removeEventListener('resize', resize);
      priceChart.remove();
      adxChart.remove();
    };
  }, []);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      // Calcula limit baseado em horas + interval
      const minutesPerCandle = parseInterval(interval);
      const limit = Math.max(50, Math.min(1000, Math.ceil((hours * 60) / minutesPerCandle)));

      const [klines, decisions] = await Promise.all([
        api.klines(symbol, interval, limit),
        api.recentTrades(hours),
      ]);

      // Ordena por tempo crescente — requisito do lightweight-charts para line e markers.
      const sortedDecisions = [...decisions].sort((a, b) => a.timestamp - b.timestamp);

      // Corta o gráfico para iniciar no primeiro registro de decisão.
      // Antes disso não há ADX/markers, então mostrar só candles ficaria desalinhado.
      const firstDecisionTs = sortedDecisions[0]?.timestamp ?? null;
      const filteredKlines: Kline[] =
        firstDecisionTs !== null ? klines.filter((k) => k.time >= firstDecisionTs) : [];

      const candleData = filteredKlines.map((k) => ({
        time: k.time as UTCTimestamp,
        open: k.open,
        high: k.high,
        low: k.low,
        close: k.close,
      }));
      candleSeriesRef.current?.setData(candleData);

      // ADX: line series exige timestamps únicos e ordenados; ficamos com o último valor
      // gravado para cada timestamp.
      const adxByTs = new Map<number, number>();
      for (const d of sortedDecisions) {
        if (d.adx !== null && d.adx !== undefined) adxByTs.set(d.timestamp, Number(d.adx));
      }
      const adxPoints = [...adxByTs.entries()].map(([t, v]) => ({
        time: t as UTCTimestamp,
        value: v,
      }));
      adxSeriesRef.current?.setData(adxPoints);

      // Markers: também precisam de timestamps únicos. Se múltiplas decisões caírem no mesmo
      // segundo, mostramos a "mais relevante" (BUY/SELL ganha de HOLD).
      const priority: Record<string, number> = { BUY: 3, SELL: 3, HOLD: 1 };
      const markerByTs = new Map<number, TradeDecision>();
      for (const d of sortedDecisions) {
        const existing = markerByTs.get(d.timestamp);
        if (!existing || priority[d.action] > priority[existing.action]) {
          markerByTs.set(d.timestamp, d);
        }
      }
      const markers: SeriesMarker<Time>[] = [...markerByTs.values()].map((d) => {
        const isBuy = d.action === 'BUY';
        const isSell = d.action === 'SELL';
        return {
          time: d.timestamp as UTCTimestamp,
          position: isBuy ? 'belowBar' : isSell ? 'aboveBar' : 'inBar',
          color: isBuy ? COLORS.buy : isSell ? COLORS.sell : COLORS.hold,
          shape: isBuy ? 'arrowUp' : isSell ? 'arrowDown' : 'circle',
          text: d.action === 'HOLD' ? undefined : d.action,
          size: d.action === 'HOLD' ? 0.8 : 1.2,
        };
      });
      markersRef.current?.setMarkers(markers);

      priceChartRef.current?.timeScale().fitContent();
      setTrades(decisions);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao carregar dados.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // Recarrega periodicamente
    const id = window.setInterval(load, 60_000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hours, interval, symbol]);

  const counts = countActions(trades);

  return (
    <div className="glass-card p-6">
      <header className="flex items-start justify-between flex-wrap gap-3 mb-4 border-b border-white/10 pb-4">
        <div>
          <h3 className="text-xl font-bold text-white">Histórico de Operações — últimas {hours}h</h3>
          <p className="text-white/40 text-xs mt-1 font-mono">
            {symbol} · {interval} · {trades.length} decisões registradas
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs font-medium">
          <Legend color={COLORS.buy} label={`BUY (${counts.BUY})`} />
          <Legend color={COLORS.sell} label={`SELL (${counts.SELL})`} />
          <Legend color={COLORS.hold} label={`HOLD (${counts.HOLD})`} />
          <button
            onClick={load}
            disabled={loading}
            title="Recarregar"
            className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-50"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>
        </div>
      </header>

      {error && (
        <p className="text-sm text-red-400 bg-red-500/10 rounded-lg p-3 border border-red-500/20 mb-4">
          {error}
        </p>
      )}

      <div className="relative">
        <div ref={priceContainerRef} className="w-full" />
        <p className="text-[10px] uppercase tracking-widest text-white/40 mt-3 mb-1">ADX (Average Directional Index)</p>
        <div className="relative">
          <div ref={adxContainerRef} className="w-full" />
          {adxTooltip && (
            <div
              className="pointer-events-none absolute z-20 px-3 py-2 rounded-lg border border-amber-400/30 bg-background/95 backdrop-blur-md shadow-xl text-xs text-white/90 max-w-xs leading-snug"
              style={{
                left: Math.min(adxTooltip.x + 12, (adxContainerRef.current?.clientWidth ?? 0) - 280),
                top: Math.max(adxTooltip.y - 60, 4),
              }}
            >
              <div className="font-semibold text-amber-300 mb-0.5">Limiar mínimo: ADX 20</div>
              <div className="text-white/70">
                O modelo foi treinado para operar apenas quando o ADX está em pelo menos 20,
                evitando ruído de preço em mercados sem tendência clara.
              </div>
            </div>
          )}
        </div>

        {!loading && trades.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/70 backdrop-blur-sm rounded-xl">
            <div className="text-center px-6 py-8 max-w-md">
              <p className="text-white/80 font-semibold mb-2">Sem decisões registradas ainda</p>
              <p className="text-white/50 text-sm leading-relaxed">
                O gráfico começa a ser plotado a partir da primeira escolha (BUY/SELL/HOLD) do modelo.
                Aguarde o próximo ciclo do trader.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const Legend = ({ color, label }: { color: string; label: string }) => (
  <span className="inline-flex items-center gap-1.5 text-white/70">
    <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
    {label}
  </span>
);

function parseInterval(interval: string): number {
  const m = interval.match(/^(\d+)([mhd])$/);
  if (!m) return 15;
  const n = parseInt(m[1], 10);
  return m[2] === 'h' ? n * 60 : m[2] === 'd' ? n * 1440 : n;
}

function countActions(decisions: TradeDecision[]) {
  return decisions.reduce(
    (acc, d) => {
      acc[d.action] = (acc[d.action] ?? 0) + 1;
      return acc;
    },
    { BUY: 0, SELL: 0, HOLD: 0 } as Record<'BUY' | 'SELL' | 'HOLD', number>,
  );
}
