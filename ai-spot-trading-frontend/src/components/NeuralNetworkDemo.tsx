import { useMemo, useRef, useState, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import * as THREE from 'three';

// Paleta inspirada na imagem de referência (Deep Learning poster).
const COLOR_TOP = '#22d3ee';     // cyan
const COLOR_BOTTOM = '#a855f7';  // purple
const COLOR_EDGE = '#5eead4';    // teal claro
const COLOR_TEXT = '#94a3b8';

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

type Phase = 0 | 1 | 2;
const PHASE_DURATION = 3.8;
const PHASE_LABELS: Record<Phase, string> = {
  0: '1 / Coletando preço + ADX (20 features)',
  1: '2 / Processando: Conv1D → BiLSTM → MHA → Dense',
  2: '3 / 4 sigmoids → média → decisão',
};

const CAM_KEYS: Record<Phase, { pos: [number, number, number] }> = {
  0: { pos: [LAYER_X[0], 0, 4] },                      // input
  1: { pos: [0, 0, 12] },                              // visão geral
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

  return (
    <>
      <ambientLight intensity={0.6} />

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
      <Canvas camera={{ position: [LAYER_X[0], 0, 4], fov: 50 }}>
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
