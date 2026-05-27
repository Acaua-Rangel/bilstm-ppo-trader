import { useMemo, useRef, useState, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import * as THREE from 'three';

// Paleta inspirada na imagem de referência (Deep Learning poster).
const COLOR_TOP = '#22d3ee';     // cyan
const COLOR_BOTTOM = '#a855f7';  // purple
const COLOR_EDGE = '#5eead4';    // teal claro
const COLOR_TEXT = '#94a3b8';
const COLOR_BINANCE = '#f0b90b'; // amarelo binance

// Arquitetura real do CNN-BiLSTM-MHA Forecaster (notebook Kaggle).
// Contagens EXATAS marcadas com 🔒 — as outras refletem a dim de saída do estágio.
interface Layer {
  name: string;
  count: number;
  cols: number;
  rows: number;
  exact: boolean;
}

const LAYERS: Layer[] = [
  { name: 'Input · 20 features',  count: 20,  cols: 4,  rows: 5,  exact: true  }, // 🔒
  { name: 'Conv1D · 48 channels', count: 48,  cols: 6,  rows: 8,  exact: false },
  { name: 'BiLSTM · 256',         count: 256, cols: 16, rows: 16, exact: false },
  { name: 'BiLSTM · 128',         count: 128, cols: 8,  rows: 16, exact: false },
  { name: 'MHA · 128',            count: 128, cols: 8,  rows: 16, exact: false },
  { name: 'Dense · 128',          count: 128, cols: 8,  rows: 16, exact: true  }, // 🔒
  { name: 'Output · 4 horizon',   count: 4,   cols: 1,  rows: 4,  exact: true  }, // 🔒
];

// Distribuição horizontal dos painéis.
const PANEL_SPAN = 14;
const FIRST_X = -PANEL_SPAN / 2;
const STEP = LAYERS.length > 1 ? PANEL_SPAN / (LAYERS.length - 1) : 0;
const LAYER_X = LAYERS.map((_, i) => FIRST_X + i * STEP);

// Rotação Y aplicada a cada painel — dá a "ilusão 3D" estilo poster Deep Learning,
// fazendo cada painel aparecer como paralelogramo em vez de retângulo.
const PANEL_ROT_Y = -0.45; // ~ -26°
const COS_R = Math.cos(PANEL_ROT_Y);
const SIN_R = Math.sin(PANEL_ROT_Y);

// ─── POSICIONAMENTO DOS INPUTS 3D ────────────────────────────────────────────
const INPUT_X = LAYER_X[0] - 4.5;   // à esquerda da 1ª camada
const CHART_Y = 0.6;                 // gráfico no topo
const ADX_Y = -1.2;                  // gauge ADX embaixo
const CHART_W = 2.8;
const CHART_H = 1.4;

type Phase = 0 | 1 | 2;
const PHASE_DURATION = 3.8;
const PHASE_LABELS: Record<Phase, string> = {
  0: '1 / Coletando preço + ADX (20 features)',
  1: '2 / Processando: Conv1D → BiLSTM → MHA → Dense',
  2: '3 / 4 sigmoids → média → decisão',
};

const CAM_KEYS: Record<Phase, { pos: [number, number, number] }> = {
  0: { pos: [INPUT_X + 1.5, 0, 7] },                    // foco nos inputs 3D
  1: { pos: [0, 0, 12] },                               // visão geral
  2: { pos: [LAYER_X[LAYERS.length - 1] + 1.5, 0, 4] }, // output + decisão
};

const OUTPUT_LABELS = ['BUY', 'HOLD', 'SELL'] as const;
const OUTPUT_COLORS = ['#71c829', '#94a3b8', '#ef4444'];
type ResultIdx = 0 | 1 | 2;

// Posições absolutas (no espaço da cena) de cada nó de cada camada — usadas para edges.
function nodeWorldPos(layerIdx: number, nodeIdx: number): THREE.Vector3 {
  const layer = LAYERS[layerIdx];
  const cellW = 2.0 / Math.max(layer.cols - 1, 1);
  const cellH = 3.0 / Math.max(layer.rows - 1, 1);
  const c = nodeIdx % layer.cols;
  const r = Math.floor(nodeIdx / layer.cols);
  const lx = layer.cols === 1 ? 0 : (c - (layer.cols - 1) / 2) * cellW;
  const ly = layer.rows === 1 ? 0 : (r - (layer.rows - 1) / 2) * cellH;
  // Aplica a rotação Y em torno do centro do painel para que os edges
  // saiam dos pontos REAIS (depois da rotação visual).
  const rx = lx * COS_R;
  const rz = -lx * SIN_R;
  return new THREE.Vector3(LAYER_X[layerIdx] + rx, ly, rz);
}

// ─── DADOS SIMULADOS DO GRÁFICO ──────────────────────────────────────────────
const CHART_RAW = [
  67200, 67350, 67100, 66800, 67050, 67400, 67800, 68200, 68050, 67600,
  67900, 68500, 69100, 68700, 68300, 68900, 69500, 69200, 69800, 70100,
  69600, 70400, 70800, 71200, 70900, 71500, 71100, 71800, 72000, 71600,
  72300, 72700,
];
const CHART_MIN = Math.min(...CHART_RAW);
const CHART_MAX = Math.max(...CHART_RAW);

// ─── GRÁFICO DE PREÇO 3D ─────────────────────────────────────────────────────
function PriceChart3D({ activation }: { activation: number }) {
  const groupRef = useRef<THREE.Group>(null);

  // Normaliza pontos para o espaço do painel
  const points = useMemo(() => {
    return CHART_RAW.map((v, i) => {
      const x = (i / (CHART_RAW.length - 1)) * CHART_W - CHART_W / 2;
      const y = ((v - CHART_MIN) / (CHART_MAX - CHART_MIN)) * CHART_H - CHART_H / 2;
      return { x, y };
    });
  }, []);

  // Linha do gráfico (segments: ponto a ponto)
  const lineGeo = useMemo(() => {
    const positions: number[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      positions.push(points[i].x, points[i].y, 0.02);
      positions.push(points[i + 1].x, points[i + 1].y, 0.02);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return g;
  }, [points]);

  // Área preenchida abaixo da linha (ShapeGeometry)
  const areaGeo = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(-CHART_W / 2, -CHART_H / 2);
    points.forEach((p) => shape.lineTo(p.x, p.y));
    shape.lineTo(CHART_W / 2, -CHART_H / 2);
    shape.closePath();
    return new THREE.ShapeGeometry(shape);
  }, [points]);

  // Grid de fundo
  const gridGeo = useMemo(() => {
    const positions: number[] = [];
    const gridLines = 5;
    const halfW = CHART_W / 2;
    const halfH = CHART_H / 2;
    // Linhas horizontais
    for (let i = 0; i <= gridLines; i++) {
      const y = -halfH + (i / gridLines) * CHART_H;
      positions.push(-halfW, y, -0.01, halfW, y, -0.01);
    }
    // Linhas verticais
    for (let i = 0; i <= 8; i++) {
      const x = -halfW + (i / 8) * CHART_W;
      positions.push(x, -halfH, -0.01, x, halfH, -0.01);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return g;
  }, []);

  // Ponto brilhante no último preço
  const lastPt = points[points.length - 1];

  const lineRef = useRef<THREE.LineSegments>(null);
  const areaRef = useRef<THREE.Mesh>(null);
  const dotRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const a = activation;
    if (lineRef.current) {
      (lineRef.current.material as THREE.LineBasicMaterial).opacity = 0.3 + a * 0.7;
    }
    if (areaRef.current) {
      (areaRef.current.material as THREE.MeshBasicMaterial).opacity = 0.04 + a * 0.12;
    }
    if (dotRef.current) {
      dotRef.current.scale.setScalar(1 + Math.sin(clock.getElapsedTime() * 3) * 0.3 * a);
    }
    if (glowRef.current) {
      (glowRef.current.material as THREE.MeshBasicMaterial).opacity =
        0.15 + Math.sin(clock.getElapsedTime() * 3) * 0.1 * a;
      glowRef.current.scale.setScalar(1 + Math.sin(clock.getElapsedTime() * 2) * 0.2 * a);
    }
  });

  return (
    <group ref={groupRef} position={[INPUT_X, CHART_Y, 0]} rotation={[0, PANEL_ROT_Y * 0.5, 0]}>
      {/* Fundo do painel */}
      <mesh position={[0, 0, -0.02]}>
        <planeGeometry args={[CHART_W + 0.5, CHART_H + 0.9]} />
        <meshBasicMaterial color="#0a1628" transparent opacity={0.7} side={THREE.DoubleSide} />
      </mesh>
      {/* Borda do painel */}
      <mesh position={[0, 0, -0.015]}>
        <planeGeometry args={[CHART_W + 0.52, CHART_H + 0.92]} />
        <meshBasicMaterial color={COLOR_TOP} transparent opacity={0.08} side={THREE.DoubleSide} />
      </mesh>

      {/* Grid de fundo */}
      <lineSegments geometry={gridGeo}>
        <lineBasicMaterial color="#ffffff" transparent opacity={0.04} />
      </lineSegments>

      {/* Área preenchida sob o gráfico */}
      <mesh ref={areaRef} geometry={areaGeo}>
        <meshBasicMaterial color={COLOR_TOP} transparent opacity={0.06} side={THREE.DoubleSide} />
      </mesh>

      {/* Linha do gráfico */}
      <lineSegments ref={lineRef} geometry={lineGeo}>
        <lineBasicMaterial color={COLOR_TOP} transparent opacity={0.4} />
      </lineSegments>

      {/* Ponto pulsante no último preço */}
      <mesh ref={dotRef} position={[lastPt.x, lastPt.y, 0.03]}>
        <circleGeometry args={[0.06, 16]} />
        <meshBasicMaterial color={COLOR_TOP} />
      </mesh>
      {/* Glow ao redor do ponto */}
      <mesh ref={glowRef} position={[lastPt.x, lastPt.y, 0.025]}>
        <circleGeometry args={[0.18, 16]} />
        <meshBasicMaterial color={COLOR_TOP} transparent opacity={0.15} />
      </mesh>

      {/* Label do título */}
      <Text
        position={[-CHART_W / 2 + 0.05, CHART_H / 2 + 0.28, 0.01]}
        fontSize={0.13}
        color="#ffffff"
        anchorX="left"
        fontWeight={700}
      >
        BTC / FDUSD
      </Text>
      <Text
        position={[CHART_W / 2 - 0.05, CHART_H / 2 + 0.28, 0.01]}
        fontSize={0.1}
        color={COLOR_TOP}
        anchorX="right"
        fontWeight={600}
      >
        15m · 128 candles
      </Text>

      {/* Label do último preço */}
      <Text
        position={[lastPt.x + 0.15, lastPt.y + 0.12, 0.03]}
        fontSize={0.09}
        color={COLOR_TOP}
        anchorX="left"
        fontWeight={600}
      >
        {`$${CHART_RAW[CHART_RAW.length - 1].toLocaleString()}`}
      </Text>

      {/* Label "Gráfico do preço" embaixo */}
      <Text
        position={[0, -CHART_H / 2 - 0.32, 0.01]}
        fontSize={0.1}
        color={COLOR_TEXT}
        anchorX="center"
      >
        Histórico de preço
      </Text>
    </group>
  );
}

// ─── ADX GAUGE 3D ─────────────────────────────────────────────────────────────
function ADXGauge3D({ activation }: { activation: number }) {
  const adxValue = 28.5;
  const RADIUS = 0.7;
  const THICKNESS = 0.08;
  const ARC_ANGLE = Math.PI * 1.4;          // arco de ~250°
  const START_ANGLE = Math.PI * 0.8;        // começa embaixo-esquerda
  const valueFrac = adxValue / 60;          // normaliza 0-60 para visual
  const threshFrac = 20 / 60;              // limiar 20

  // Arco de fundo (track)
  const trackGeo = useMemo(() => {
    const positions: number[] = [];
    const segments = 48;
    for (let i = 0; i < segments; i++) {
      const a1 = START_ANGLE + (i / segments) * ARC_ANGLE;
      const a2 = START_ANGLE + ((i + 1) / segments) * ARC_ANGLE;
      // outer
      positions.push(Math.cos(a1) * RADIUS, Math.sin(a1) * RADIUS, 0);
      positions.push(Math.cos(a2) * RADIUS, Math.sin(a2) * RADIUS, 0);
      // inner
      positions.push(Math.cos(a1) * (RADIUS - THICKNESS), Math.sin(a1) * (RADIUS - THICKNESS), 0);
      positions.push(Math.cos(a2) * (RADIUS - THICKNESS), Math.sin(a2) * (RADIUS - THICKNESS), 0);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return g;
  }, []);

  // Arco de valor (preenchido)
  const valueGeo = useMemo(() => {
    const shape = new THREE.Shape();
    const segments = 32;
    const endAngle = START_ANGLE + valueFrac * ARC_ANGLE;
    // arco externo
    for (let i = 0; i <= segments; i++) {
      const a = START_ANGLE + (i / segments) * (endAngle - START_ANGLE);
      const fn = i === 0 ? 'moveTo' : 'lineTo';
      shape[fn](Math.cos(a) * RADIUS, Math.sin(a) * RADIUS);
    }
    // arco interno (reverso)
    for (let i = segments; i >= 0; i--) {
      const a = START_ANGLE + (i / segments) * (endAngle - START_ANGLE);
      shape.lineTo(Math.cos(a) * (RADIUS - THICKNESS), Math.sin(a) * (RADIUS - THICKNESS));
    }
    shape.closePath();
    return new THREE.ShapeGeometry(shape);
  }, []);

  // Marcador de limiar (threshold = 20)
  const threshAngle = START_ANGLE + threshFrac * ARC_ANGLE;
  const threshGeo = useMemo(() => {
    const positions: number[] = [];
    positions.push(
      Math.cos(threshAngle) * (RADIUS - THICKNESS - 0.05), Math.sin(threshAngle) * (RADIUS - THICKNESS - 0.05), 0.01,
      Math.cos(threshAngle) * (RADIUS + 0.05), Math.sin(threshAngle) * (RADIUS + 0.05), 0.01,
    );
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return g;
  }, []);

  const valueRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const a = activation;
    if (valueRef.current) {
      (valueRef.current.material as THREE.MeshBasicMaterial).opacity = 0.3 + a * 0.7;
    }
    if (glowRef.current) {
      const pulse = 0.12 + Math.sin(clock.getElapsedTime() * 2.5) * 0.06 * a;
      (glowRef.current.material as THREE.MeshBasicMaterial).opacity = pulse;
    }
  });

  // Ponto indicador na ponta do arco de valor
  const needleAngle = START_ANGLE + valueFrac * ARC_ANGLE;
  const needleX = Math.cos(needleAngle) * (RADIUS - THICKNESS / 2);
  const needleY = Math.sin(needleAngle) * (RADIUS - THICKNESS / 2);

  return (
    <group position={[INPUT_X, ADX_Y, 0]} rotation={[0, PANEL_ROT_Y * 0.5, 0]}>
      {/* Fundo do painel */}
      <mesh position={[0, 0, -0.02]}>
        <planeGeometry args={[2.2, 2.2]} />
        <meshBasicMaterial color="#0a1628" transparent opacity={0.7} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0, -0.015]}>
        <planeGeometry args={[2.22, 2.22]} />
        <meshBasicMaterial color={COLOR_BINANCE} transparent opacity={0.06} side={THREE.DoubleSide} />
      </mesh>

      {/* Track de fundo */}
      <lineSegments geometry={trackGeo}>
        <lineBasicMaterial color="#ffffff" transparent opacity={0.08} />
      </lineSegments>

      {/* Arco de valor preenchido */}
      <mesh ref={valueRef} geometry={valueGeo}>
        <meshBasicMaterial color={COLOR_BINANCE} transparent opacity={0.5} side={THREE.DoubleSide} />
      </mesh>

      {/* Glow atrás do arco */}
      <mesh ref={glowRef} geometry={valueGeo} position={[0, 0, -0.005]}>
        <meshBasicMaterial color={COLOR_BINANCE} transparent opacity={0.12} side={THREE.DoubleSide} />
      </mesh>

      {/* Marcador de limiar (threshold 20) */}
      <lineSegments geometry={threshGeo}>
        <lineBasicMaterial color="#ef4444" transparent opacity={0.6} />
      </lineSegments>
      <Text
        position={[
          Math.cos(threshAngle) * (RADIUS + 0.18),
          Math.sin(threshAngle) * (RADIUS + 0.18),
          0.01,
        ]}
        fontSize={0.08}
        color="#ef4444"
        anchorX="center"
        fontWeight={600}
      >
        20
      </Text>

      {/* Ponto na ponta do arco */}
      <mesh position={[needleX, needleY, 0.02]}>
        <circleGeometry args={[0.06, 16]} />
        <meshBasicMaterial color={COLOR_BINANCE} />
      </mesh>

      {/* Valor central grande */}
      <Text
        position={[0, -0.05, 0.01]}
        fontSize={0.35}
        color="#ffffff"
        anchorX="center"
        anchorY="middle"
        fontWeight={700}
      >
        {adxValue.toFixed(1)}
      </Text>

      {/* Label "ADX" */}
      <Text
        position={[0, 0.28, 0.01]}
        fontSize={0.11}
        color={COLOR_BINANCE}
        anchorX="center"
        fontWeight={600}
      >
        ADX INDEX
      </Text>

      {/* Sub-label */}
      <Text
        position={[0, -0.35, 0.01]}
        fontSize={0.09}
        color="#22c55e"
        anchorX="center"
        fontWeight={600}
      >
        Tendência Forte
      </Text>

      {/* Escala min/max do arco */}
      <Text
        position={[
          Math.cos(START_ANGLE) * (RADIUS + 0.15),
          Math.sin(START_ANGLE) * (RADIUS + 0.15),
          0.01,
        ]}
        fontSize={0.07}
        color={COLOR_TEXT}
        anchorX="center"
      >
        0
      </Text>
      <Text
        position={[
          Math.cos(START_ANGLE + ARC_ANGLE) * (RADIUS + 0.15),
          Math.sin(START_ANGLE + ARC_ANGLE) * (RADIUS + 0.15),
          0.01,
        ]}
        fontSize={0.07}
        color={COLOR_TEXT}
        anchorX="center"
      >
        60
      </Text>

      {/* Label embaixo do painel */}
      <Text
        position={[0, -0.95, 0.01]}
        fontSize={0.1}
        color={COLOR_TEXT}
        anchorX="center"
      >
        Average Directional Index
      </Text>
    </group>
  );
}

// ─── EDGES: INPUTS 3D → CAMADA INPUT ─────────────────────────────────────────
function InputFlowEdges({ activation }: { activation: number }) {
  // Posições de saída dos painéis de input (borda direita do gráfico e do gauge)
  const chartRight = INPUT_X + CHART_W / 2 * Math.cos(PANEL_ROT_Y * 0.5);
  const adxRight = INPUT_X + 0.8;

  // Conecta o gráfico aos nós superiores do input (features de preço → ~15 nós)
  // Conecta o ADX aos nós inferiores (ADX feature → ~5 nós)
  const { chartEdges, adxEdges } = useMemo(() => {
    const cPairs: EdgePair[] = [];
    const aPairs: EdgePair[] = [];
    const inputLayer = LAYERS[0];

    for (let n = 0; n < inputLayer.count; n++) {
      const target = nodeWorldPos(0, n);
      const row = Math.floor(n / inputLayer.cols);
      const t = row / (inputLayer.rows - 1); // 0 = topo, 1 = base

      if (t < 0.7) {
        // Nós do topo/meio ← Gráfico
        const srcY = CHART_Y + (Math.random() - 0.5) * CHART_H * 0.6;
        cPairs.push({
          from: new THREE.Vector3(chartRight, srcY, 0),
          to: target,
        });
      } else {
        // Nós da base ← ADX
        const srcY = ADX_Y + (Math.random() - 0.5) * 0.4;
        aPairs.push({
          from: new THREE.Vector3(adxRight, srcY, 0),
          to: target,
        });
      }
    }
    return { chartEdges: cPairs, adxEdges: aPairs };
  }, []);

  const chartGeo = useMemo(() => {
    const positions: number[] = [];
    chartEdges.forEach(({ from, to }) => {
      positions.push(from.x, from.y, from.z, to.x, to.y, to.z);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return g;
  }, [chartEdges]);

  const adxGeo = useMemo(() => {
    const positions: number[] = [];
    adxEdges.forEach(({ from, to }) => {
      positions.push(from.x, from.y, from.z, to.x, to.y, to.z);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return g;
  }, [adxEdges]);

  const chartRef = useRef<THREE.LineSegments>(null);
  const adxRef = useRef<THREE.LineSegments>(null);

  useFrame(() => {
    const a = activation;
    if (chartRef.current) {
      (chartRef.current.material as THREE.LineBasicMaterial).opacity = 0.05 + a * 0.5;
    }
    if (adxRef.current) {
      (adxRef.current.material as THREE.LineBasicMaterial).opacity = 0.05 + a * 0.5;
    }
  });

  return (
    <>
      <lineSegments ref={chartRef} geometry={chartGeo}>
        <lineBasicMaterial color={COLOR_TOP} transparent opacity={0.1} />
      </lineSegments>
      <lineSegments ref={adxRef} geometry={adxGeo}>
        <lineBasicMaterial color={COLOR_BINANCE} transparent opacity={0.1} />
      </lineSegments>
    </>
  );
}

// ─── COMPONENTES EXISTENTES (DotPanel, Edges, etc.) ──────────────────────────

function DotPanel({ layerIdx, activation }: { layerIdx: number; activation: number }) {
  const layer = LAYERS[layerIdx];

  const geometry = useMemo(() => {
    const positions: number[] = [];
    const colors: number[] = [];
    const colorTop = new THREE.Color(COLOR_TOP);
    const colorBottom = new THREE.Color(COLOR_BOTTOM);

    for (let i = 0; i < layer.count; i++) {
      const p = nodeWorldPos(layerIdx, i);
      positions.push(p.x - LAYER_X[layerIdx], p.y, p.z);
      const t = layer.rows > 1 ? Math.floor(i / layer.cols) / (layer.rows - 1) : 0.5;
      const col = colorTop.clone().lerp(colorBottom, t);
      colors.push(col.r, col.g, col.b);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return geo;
  }, [layer, layerIdx]);

  const ref = useRef<THREE.Points>(null);
  useFrame(() => {
    if (!ref.current) return;
    const mat = ref.current.material as THREE.PointsMaterial;
    mat.opacity = 0.35 + activation * 0.6;
    mat.size = 0.06 + activation * 0.04;
  });

  return (
    <points
      ref={ref}
      position={[LAYER_X[layerIdx], 0, 0]}
      rotation={[0, PANEL_ROT_Y, 0]}
      geometry={geometry}
    >
      <pointsMaterial
        vertexColors
        size={0.07}
        transparent
        opacity={0.35}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  );
}

interface EdgePair { from: THREE.Vector3; to: THREE.Vector3; }

function Edges({ pairs, intensity }: { pairs: EdgePair[]; intensity: number }) {
  const ref = useRef<THREE.LineSegments>(null);
  const geometry = useMemo(() => {
    const positions: number[] = [];
    pairs.forEach(({ from, to }) => {
      positions.push(from.x, from.y, from.z, to.x, to.y, to.z);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return g;
  }, [pairs]);

  useFrame(() => {
    if (!ref.current) return;
    const mat = ref.current.material as THREE.LineBasicMaterial;
    mat.color = new THREE.Color(COLOR_EDGE);
    mat.opacity = 0.1 + intensity * 0.7;
  });

  return (
    <lineSegments ref={ref} geometry={geometry}>
      <lineBasicMaterial color={COLOR_EDGE} transparent opacity={0.1} />
    </lineSegments>
  );
}

function ColoredEdges({ pairs, color, intensity }: { pairs: EdgePair[]; color: string; intensity: number }) {
  const ref = useRef<THREE.LineSegments>(null);
  const geometry = useMemo(() => {
    const positions: number[] = [];
    pairs.forEach(({ from, to }) => {
      positions.push(from.x, from.y, from.z, to.x, to.y, to.z);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return g;
  }, [pairs]);

  useFrame(() => {
    if (!ref.current) return;
    const mat = ref.current.material as THREE.LineBasicMaterial;
    mat.color = new THREE.Color(color);
    mat.opacity = 0.08 + intensity * 0.85;
  });

  return (
    <lineSegments ref={ref} geometry={geometry}>
      <lineBasicMaterial color={color} transparent opacity={0.1} />
    </lineSegments>
  );
}

function CameraRig({ phase }: { phase: Phase }) {
  const { camera } = useThree();
  const targetPos = useRef(new THREE.Vector3(...CAM_KEYS[0].pos));
  const lookAt = useRef(new THREE.Vector3());

  useEffect(() => {
    targetPos.current.set(...CAM_KEYS[phase].pos);
  }, [phase]);

  useFrame(() => {
    camera.position.lerp(targetPos.current, 0.03);
    lookAt.current.set(camera.position.x, camera.position.y, 0);
    camera.lookAt(lookAt.current);
  });
  return null;
}

function NetworkScene({ activeOutput, phase }: { activeOutput: ResultIdx; phase: Phase }) {
  // Edges entre camadas: amostragem DETERMINÍSTICA por linha do grid.
  // Selecionamos N linhas igualmente espaçadas em ambos os painéis, conectando cada
  // linha-origem à mesma linha-destino. O resultado é uma "treliça" estruturada que
  // se lê como conexões reais (não como ruído).
  const edgesPerTransition = useMemo(() => {
    const ROWS_PER_TRANSITION = 6;
    return LAYERS.slice(0, -1).map((from, i) => {
      const to = LAYERS[i + 1];
      const pairs: EdgePair[] = [];

      // Para cada uma das N "linhas guia", escolhemos um node representativo em cada lado.
      // Como o painel é um grid (rows × cols), pegamos a linha 'r' e usamos a coluna do meio
      // (1ª linha do painel = topo, última = base). Assim as conexões traçam linhas claras
      // de topo-a-topo, meio-a-meio, base-a-base, com pequenos cruzamentos intermediários.
      for (let g = 0; g < ROWS_PER_TRANSITION; g++) {
        const fRow = Math.floor(((g + 0.5) / ROWS_PER_TRANSITION) * from.rows);
        const tRow = Math.floor(((g + 0.5) / ROWS_PER_TRANSITION) * to.rows);

        // Conecta também aos vizinhos imediatos do destino para criar o "fan" suave.
        const fIdx = fRow * from.cols + Math.floor(from.cols / 2);
        for (let d = -1; d <= 1; d++) {
          const tRowAdj = Math.min(Math.max(tRow + d, 0), to.rows - 1);
          const tIdx = tRowAdj * to.cols + Math.floor(to.cols / 2);
          pairs.push({ from: nodeWorldPos(i, fIdx), to: nodeWorldPos(i + 1, tIdx) });
        }
      }
      return pairs;
    });
  }, []);

  // Edges Output → BUY/HOLD/SELL (etapa de derivação, não uma layer treinada).
  // Geramos 1 conjunto por opção para poder destacar a vencedora na fase 2.
  const decisionEdges = useMemo(() => {
    const lastIdx = LAYERS.length - 1;
    const outputCount = LAYERS[lastIdx].count;
    const decisionX = LAYER_X[lastIdx] + 2.2;
    return [0, 1, 2].map((d) => {
      const decisionPos = new THREE.Vector3(decisionX, 0.7 - d * 0.7, 0);
      const pairs: EdgePair[] = [];
      for (let n = 0; n < outputCount; n++) {
        pairs.push({ from: nodeWorldPos(lastIdx, n), to: decisionPos });
      }
      return pairs;
    });
  }, []);

  const [pulseT, setPulseT] = useState(0);
  useFrame(({ clock }) => setPulseT(clock.getElapsedTime()));

  // Onda de ativação avança pelas camadas (só durante fase 1 e 2).
  const wave = phase === 0 ? -1 : (pulseT * 0.9) % (LAYERS.length + 1);

  const layerActivation = (idx: number) => {
    if (phase === 0) return idx === 0 ? 0.85 : 0.15;
    const diff = Math.abs(idx + 0.5 - wave);
    return Math.max(0.15, 1 - diff * 0.9);
  };

  const edgeActivation = (i: number) =>
    Math.min(layerActivation(i), layerActivation(i + 1)) * 0.9;

  // Ativação dos painéis de input (forte na fase 0, fraco nas outras)
  const inputActivation = phase === 0 ? 0.95 : 0.15;

  return (
    <>
      <ambientLight intensity={0.6} />

      {/* ─── INPUTS 3D: Gráfico + ADX ─────────────────────────────── */}
      <PriceChart3D activation={inputActivation} />
      <ADXGauge3D activation={inputActivation} />
      <InputFlowEdges activation={inputActivation} />

      {/* Painéis pontilhados (cada layer) */}
      {LAYERS.map((_, i) => (
        <DotPanel key={`p-${i}`} layerIdx={i} activation={layerActivation(i)} />
      ))}

      {/* Edges entre camadas */}
      {edgesPerTransition.map((pairs, i) => (
        <Edges key={`e-${i}`} pairs={pairs} intensity={edgeActivation(i)} />
      ))}

      {/* Labels embaixo de cada painel */}
      {LAYERS.map((layer, i) => (
        <Text
          key={`l-${i}`}
          position={[LAYER_X[i], -1.9, 0]}
          fontSize={0.16}
          color={layer.exact ? '#e2e8f0' : COLOR_TEXT}
          anchorX="center"
          fontWeight={layer.exact ? 600 : 400}
        >
          {layer.name}
        </Text>
      ))}

      {/* Edges Output → Decisão. Acendem com a cor da decisão na fase 2. */}
      {decisionEdges.map((pairs, i) => (
        <ColoredEdges
          key={`de-${i}`}
          pairs={pairs}
          color={OUTPUT_COLORS[i]}
          intensity={
            phase === 2
              ? i === activeOutput
                ? 1
                : 0.08
              : layerActivation(LAYERS.length - 1) * 0.25
          }
        />
      ))}

      {/* Decisão final (BUY/HOLD/SELL) à direita do último painel */}
      {OUTPUT_LABELS.map((label, i) => {
        const isActive = i === activeOutput && phase === 2;
        const y = 0.7 - i * 0.7;
        const x = LAYER_X[LAYERS.length - 1] + 2.2;
        return (
          <group key={`r-${i}`} position={[x, y, 0]}>
            <mesh>
              <circleGeometry args={[isActive ? 0.22 : 0.12, 24]} />
              <meshBasicMaterial
                color={OUTPUT_COLORS[i]}
                transparent
                opacity={isActive ? 1 : 0.3}
              />
            </mesh>
            <Text
              position={[0.45, 0, 0]}
              fontSize={0.24}
              color={isActive ? OUTPUT_COLORS[i] : '#475569'}
              anchorX="left"
              anchorY="middle"
            >
              {label}
            </Text>
          </group>
        );
      })}
    </>
  );
}

export const NeuralNetworkDemo = () => {
  const [phase, setPhase] = useState<Phase>(0);
  const [activeOutput, setActiveOutput] = useState<ResultIdx>(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setPhase((p) => {
        const next = ((p + 1) % 3) as Phase;
        if (next === 2) {
          setActiveOutput((prev) => ((prev + 1) % 3) as ResultIdx);
        }
        return next;
      });
    }, PHASE_DURATION * 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="relative w-full h-[480px] rounded-3xl overflow-hidden border border-white/5 bg-black">
      <Canvas camera={{ position: [CAM_KEYS[0].pos[0], CAM_KEYS[0].pos[1], CAM_KEYS[0].pos[2]], fov: 50 }}>
        <CameraRig phase={phase} />
        <NetworkScene activeOutput={activeOutput} phase={phase} />
      </Canvas>

      <div className="absolute top-4 left-4 right-4 pointer-events-none">
        <span className="text-xs uppercase tracking-widest text-white/70 font-semibold">
          {PHASE_LABELS[phase]}
        </span>
      </div>

      <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between gap-3 pointer-events-none">
        {([0, 1, 2] as Phase[]).map((p) => (
          <div
            key={p}
            className={`flex-1 h-0.5 rounded-full transition-colors duration-500 ${
              p === phase ? 'bg-primary' : 'bg-white/10'
            }`}
          />
        ))}
      </div>
    </div>
  );
};
