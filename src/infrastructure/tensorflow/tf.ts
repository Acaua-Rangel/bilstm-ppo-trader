import type * as TFType from "@tensorflow/tfjs-node";

/**
 * Single source of truth for the TensorFlow runtime.
 *
 * Picks the backend at startup based on (in priority order):
 *   1. CLI flag:  --device=auto|cpu|gpu
 *   2. Env var:   TF_DEVICE=auto|cpu|gpu
 *   3. Default:   auto
 *
 * "auto" tries GPU first, falls back to CPU if @tensorflow/tfjs-node-gpu
 * is not installed or fails to load (no CUDA, wrong driver, etc.).
 *
 * "gpu" attempts GPU, warns and falls back to CPU if unavailable.
 * "cpu" forces CPU regardless of GPU availability.
 */

export type DeviceMode = "auto" | "cpu" | "gpu";
export type ActiveBackend = "cpu" | "gpu";

function resolveDeviceMode(): DeviceMode {
  const cliArg = process.argv.find(a => a.startsWith("--device="));
  if (cliArg) {
    const value = cliArg.split("=")[1];
    if (value === "auto" || value === "cpu" || value === "gpu") return value;
    console.warn(`[TF] Invalid --device value: ${value}, using "auto"`);
  }
  const envVal = process.env.TF_DEVICE;
  if (envVal === "auto" || envVal === "cpu" || envVal === "gpu") return envVal;
  return "auto";
}

function attemptLoad(packageName: string): typeof TFType | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(packageName) as typeof TFType;
  } catch {
    return null;
  }
}

function loadBackend(mode: DeviceMode): { module: typeof TFType; backend: ActiveBackend } {
  if (mode === "gpu" || mode === "auto") {
    const gpu = attemptLoad("@tensorflow/tfjs-node-gpu");
    if (gpu) return { module: gpu, backend: "gpu" };
    if (mode === "gpu") {
      console.warn(
        "[TF] GPU requested but @tensorflow/tfjs-node-gpu is not available — " +
        "falling back to CPU. Install it with: npm install @tensorflow/tfjs-node-gpu"
      );
    }
  }
  const cpu = attemptLoad("@tensorflow/tfjs-node");
  if (!cpu) {
    throw new Error(
      "Neither @tensorflow/tfjs-node-gpu nor @tensorflow/tfjs-node could be loaded. " +
      "Run: npm install @tensorflow/tfjs-node"
    );
  }
  return { module: cpu, backend: "cpu" };
}

const requestedMode = resolveDeviceMode();
const loaded = loadBackend(requestedMode);

console.log(`[TF] Backend: ${loaded.backend.toUpperCase()} (mode: ${requestedMode})`);

export const tf = loaded.module;
export const activeBackend: ActiveBackend = loaded.backend;
export const requestedDeviceMode: DeviceMode = requestedMode;
