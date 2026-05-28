import { useEffect, useRef, useState } from 'react';
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
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
  text: '#a0a8b0',
  grid: 'rgba(255,255,255,0.04)',
  border: 'rgba(255,255,255,0.08)',
  up: '#71c829',
  down: '#ef4444',
  adx: '#f0b90b',
  zoneWin:  'rgba(113, 200, 41, 0.18)',
  zoneLoss: 'rgba(239, 68,  68, 0.18)',
};

// ─── Primitive de zonas de fundo ──────────────────────────────────────────────

interface Zone { from: UTCTimestamp; to: UTCTimestamp; color: string; }

// Renderizador: desenha retângulos coloridos no canvas do chart.
class ZoneRenderer {
  private zones: Zone[];
  private chart: IChartApi | null;
  constructor(zones: Zone[], chart: IChartApi | null) { this.zones = zones; this.chart = chart; }

  draw(target: {
    useBitmapCoordinateSpace: (fn: (scope: {
      context: CanvasRenderingContext2D;
      bitmapSize: { width: number; height: number };
      horizontalPixelRatio: number;
    }) => void) => void;
  }) {
    if (!this.chart) return;
    const { chart, zones } = this;
    target.useBitmapCoordinateSpace(({ context, bitmapSize, horizontalPixelRatio }) => {
      for (const zone of zones) {
        const x1 = chart.timeScale().timeToCoordinate(zone.from as Time);
        const x2 = chart.timeScale().timeToCoordinate(zone.to as Time);
        if (x1 === null || x2 === null) continue;
        const bx = Math.round(Math.min(x1, x2) * horizontalPixelRatio);
        const bw = Math.round(Math.abs(x2 - x1) * horizontalPixelRatio);
        context.fillStyle = zone.color;
        context.fillRect(bx, 0, bw, bitmapSize.height);
      }
    });
  }
}

// Primitive completo compatível com ISeriesPrimitive<Time> do lightweight-charts v5.
class TradeZonePrimitive {
  private zones: Zone[] = [];
  private chart: IChartApi | null = null;
  private _requestUpdate: (() => void) | null = null;

  attached({ chart, requestUpdate }: { chart: IChartApi; requestUpdate: () => void }) {
    this.chart = chart;
    this._requestUpdate = requestUpdate;
  }

  detached() {
    this.chart = null;
    this._requestUpdate = null;
  }

  updateAllViews() {}

  paneViews() {
    const renderer = new ZoneRenderer(this.zones, this.chart);
    return [{ renderer: () => renderer, zOrder: () => 'bottom' as const }];
  }

  setZones(zones: Zone[]) {
    this.zones = zones;
    this._requestUpdate?.();
  }
}

// ─── ADX calculado localmente a partir dos klines ────────────────────────────

function calcAdx(klines: Kline[], period = 14): Array<{ time: number; value: number }> {
  const n = klines.length;
  if (n < period * 2 + 1) return [];
  const alpha = 2.0 / (period + 1);

  function ema(values: number[]): number[] {
    const result = new Array<number>(values.length).fill(NaN);
    let firstValid = 0;
    while (firstValid < values.length && isNaN(values[firstValid])) firstValid++;
    const seedEnd = firstValid + period;
    if (seedEnd > values.length) return result;
    if (values.slice(firstValid, seedEnd).some(isNaN)) return result;
    result[seedEnd - 1] = values.slice(firstValid, seedEnd).reduce((a, b) => a + b, 0) / period;
    for (let i = seedEnd; i < values.length; i++) {
      result[i] = isNaN(values[i])
        ? result[i - 1]
        : values[i] * alpha + result[i - 1] * (1 - alpha);
    }
    return result;
  }

  const tr: number[] = [];
  const plusDm: number[] = [];
  const minusDm: number[] = [];
  for (let i = 1; i < n; i++) {
    const { high: h, low: l } = klines[i];
    const pc = klines[i - 1].close;
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    const up = h - klines[i - 1].high;
    const dn = klines[i - 1].low - l;
    plusDm.push(up > dn && up > 0 ? up : 0);
    minusDm.push(dn > up && dn > 0 ? dn : 0);
  }

  const atr = ema(tr);
  const sPlusDm = ema(plusDm);
  const sMinusDm = ema(minusDm);

  const dx: number[] = tr.map((_, i) => {
    if (isNaN(atr[i])) return NaN;
    const pdi = 100 * sPlusDm[i] / (atr[i] + 1e-10);
    const mdi = 100 * sMinusDm[i] / (atr[i] + 1e-10);
    return 100 * Math.abs(pdi - mdi) / (pdi + mdi + 1e-10);
  });

  const adxArr = ema(dx);
  const out: Array<{ time: number; value: number }> = [];
  for (let i = 0; i < adxArr.length; i++) {
    if (!isNaN(adxArr[i])) out.push({ time: klines[i + 1].time, value: adxArr[i] });
  }
  return out;
}

// ─── Lógica de construção de zonas a partir das decisões ──────────────────────

interface ZoneStats { zones: Zone[]; wins: number; losses: number; holds: number; }

function buildZones(decisions: TradeDecision[], candleSeconds: number): ZoneStats {
  const sorted = [...decisions].sort((a, b) => a.timestamp - b.timestamp);
  const zones: Zone[] = [];
  let openBuy: TradeDecision | null = null;
  let wins = 0;
  let losses = 0;

  for (const d of sorted) {
    if (d.action === 'BUY' && !openBuy) {
      openBuy = d;
    } else if (d.action === 'SELL' && openBuy) {
      const profitable = d.pnl > 0;
      if (profitable) wins++; else losses++;
      zones.push({
        from: openBuy.timestamp as UTCTimestamp,
        // Extende até o fim do candle do SELL para cobrir o candle inteiro
        to: (d.timestamp + candleSeconds) as UTCTimestamp,
        color: profitable ? COLORS.zoneWin : COLORS.zoneLoss,
      });
      openBuy = null;
    }
  }

  const holds = decisions.filter(d => d.action === 'HOLD').length;
  return { zones, wins, losses, holds };
}

// ─── Componente ───────────────────────────────────────────────────────────────

export const TradingChart = ({ hours = 24, interval = '15m', symbol = 'BTCFDUSD' }: Props) => {
  const priceContainerRef = useRef<HTMLDivElement>(null);
  const adxContainerRef = useRef<HTMLDivElement>(null);
  const priceChartRef = useRef<IChartApi | null>(null);
  const adxChartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const adxSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const zonePrimitiveRef = useRef<TradeZonePrimitive | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trades, setTrades] = useState<TradeDecision[]>([]);
  const [stats, setStats] = useState({ wins: 0, losses: 0, holds: 0 });
  const [adxTooltip, setAdxTooltip] = useState<{ x: number; y: number } | null>(null);

  // Inicializa os charts uma vez
  useEffect(() => {
    if (!priceContainerRef.current || !adxContainerRef.current) return;

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

    // Anexa o primitive de zonas ao candle series
    const primitive = new TradeZonePrimitive();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (candle as any).attachPrimitive(primitive);

    priceChartRef.current = priceChart;
    candleSeriesRef.current = candle;
    zonePrimitiveRef.current = primitive;

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

    adxLine.createPriceLine({
      price: 20,
      color: 'rgba(241, 191, 11, 0.6)',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: 'min 20',
    });

    adxChart.subscribeCrosshairMove((param) => {
      if (!param.point || param.point.y === undefined) { setAdxTooltip(null); return; }
      const yOf20 = adxLine.priceToCoordinate(20);
      if (yOf20 === null || yOf20 === undefined) { setAdxTooltip(null); return; }
      if (Math.abs(param.point.y - yOf20) < 6) setAdxTooltip({ x: param.point.x, y: yOf20 });
      else setAdxTooltip(null);
    });

    const sync = (source: IChartApi, target: IChartApi) => {
      source.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (range) target.timeScale().setVisibleLogicalRange(range);
      });
    };
    sync(priceChart, adxChart);
    sync(adxChart, priceChart);

    const syncScaleWidth = () => {
      const w = priceChart.priceScale('right').width();
      if (w > 0) adxChart.applyOptions({ rightPriceScale: { minimumWidth: w } });
    };

    const resize = () => {
      if (priceContainerRef.current) priceChart.resize(priceContainerRef.current.clientWidth, 380);
      if (adxContainerRef.current) adxChart.resize(adxContainerRef.current.clientWidth, 130);
      syncScaleWidth();
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
      const minutesPerCandle = parseInterval(interval);
      const limit = Math.max(50, Math.min(1000, Math.ceil((hours * 60) / minutesPerCandle)));

      const [klines, decisions] = await Promise.all([
        api.klines(symbol, interval, limit),
        api.recentTrades(hours),
      ]);

      const sortedDecisions = [...decisions].sort((a, b) => a.timestamp - b.timestamp);
      const firstDecisionTs = sortedDecisions[0]?.timestamp ?? null;
      const filteredKlines: Kline[] =
        firstDecisionTs !== null ? klines.filter((k) => k.time >= firstDecisionTs) : [];

      candleSeriesRef.current?.setData(
        filteredKlines.map((k) => ({
          time: k.time as UTCTimestamp,
          open: k.open, high: k.high, low: k.low, close: k.close,
        }))
      );

      adxSeriesRef.current?.setData(
        calcAdx(klines, 14)
          .filter(({ time }) => firstDecisionTs === null || time >= firstDecisionTs)
          .map(({ time, value }) => ({ time: time as UTCTimestamp, value }))
      );

      // Constrói zonas verde/vermelha a partir dos pares BUY→SELL
      const candleSeconds = minutesPerCandle * 60;
      const { zones, wins, losses, holds } = buildZones(sortedDecisions, candleSeconds);
      zonePrimitiveRef.current?.setZones(zones);
      setStats({ wins, losses, holds });

      priceChartRef.current?.timeScale().fitContent();
      requestAnimationFrame(() => {
        const w = priceChartRef.current?.priceScale('right').width() ?? 0;
        if (w > 0) adxChartRef.current?.applyOptions({ rightPriceScale: { minimumWidth: w } });
      });
      setTrades(decisions);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao carregar dados.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const id = window.setInterval(load, 60_000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hours, interval, symbol]);

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
          <ZoneLegend color={COLORS.zoneWin}  label={`Acertos (${stats.wins})`} />
          <ZoneLegend color={COLORS.zoneLoss} label={`Erros (${stats.losses})`} />
          <ZoneLegend color="rgba(148,163,184,0.15)" label={`HOLD (${stats.holds})`} />
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

const ZoneLegend = ({ color, label }: { color: string; label: string }) => (
  <span className="inline-flex items-center gap-1.5 text-white/70">
    <span className="w-8 h-3 rounded-sm" style={{ background: color, border: '1px solid rgba(255,255,255,0.1)' }} />
    {label}
  </span>
);

function parseInterval(interval: string): number {
  const m = interval.match(/^(\d+)([mhd])$/);
  if (!m) return 15;
  const n = parseInt(m[1], 10);
  return m[2] === 'h' ? n * 60 : m[2] === 'd' ? n * 1440 : n;
}
