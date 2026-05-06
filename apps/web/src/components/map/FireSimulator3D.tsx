"use client";

// 3D fire-spread visualizer — v2 (research-driven rebuild).
//
// What landed:
//   - Fire that spreads on the GROUND via a per-cell CA mask sampled by the
//     terrain (ported from pgermon/wildfire's wind-biased rule table +
//     andrewkchan/fire-simulation's GPGPU pattern, simplified to CPU at 96^2).
//   - Landmark labels (drei <Text> via <Billboard>) — cities, ridges, water,
//     highways, and the incident itself.
//   - Animated dispatched units with ETA labels travelling along a
//     CatmullRomCurve3 from base → incident, ease-out arrival (slow-near).
//   - Wind-advected ember particles + smoke column (kept from v1).
//   - Pure-black scene background to match the staple-derived UI tokens.
//
// Refs:
//   https://github.com/pgermon/wildfire (CA wind-biased rule table)
//   https://github.com/andrewkchan/fire-simulation (GPGPU CA pattern)
//   https://github.com/vasturiano/r3f-globe (label/path animation patterns)
//   https://threejs.org/docs/#api/en/extras/curves/CatmullRomCurve3

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Text, Billboard, Stars, Line } from "@react-three/drei";
import * as THREE from "three";

import type { WindGrid } from "@/lib/wind/grid";

interface ResourceMarker {
  id: string;
  kind: "engine" | "helicopter" | "fixed-wing" | "dozer" | "hand-crew";
  bearingDeg: number;
  distanceKm: number;
  etaMinutes: number;
  /** Optional human-readable unit identifier (e.g., "E-28", "H-301"). */
  name?: string;
  /** Optional base/station name (e.g., "Pollock Pines Station 28"). */
  baseName?: string;
}

interface Landmark {
  x: number;
  z: number;
  label: string;
  kind: "city" | "ridge" | "water" | "highway";
}

interface FireSimulator3DProps {
  windDirDeg: number;
  windSpeedMs: number;
  predicted1hAcres?: number;
  predicted6hAcres?: number;
  predicted24hAcres?: number;
  risk?: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  resources?: ResourceMarker[];
  landmarks?: Landmark[];
  lowDetail?: boolean;
  /**
   * Optional real DEM heightmap (TERRAIN_RES x TERRAIN_RES Float32Array
   * normalised to scene units, length 96^2 = 9216). When present, this
   * replaces the procedural sine-noise terrain. Use the
   * `useDemHeightmap()` hook to fetch real elevation from AWS Terrain
   * Tiles. Falls back gracefully to procedural when null/undefined.
   */
  demHeightmap?: Float32Array | null;
  /**
   * Optional spatial wind grid (typically 5x5) sampled from Open-Meteo.
   * When present, the embers + ground CA sample the grid via bilinear
   * interpolation (each cell gets its own wind vector). When absent the
   * existing single-vector wind logic is used.
   */
  windGrid?: WindGrid | null;
  /**
   * Whether to render the wind-streamline overlay. Defaults to true when
   * `windGrid` is supplied so the dispatcher sees the field structure.
   */
  showWindStreamlines?: boolean;
}

const TERRAIN_SIZE = 40;
const TERRAIN_RES = 96;

const RISK_COLORS: Record<NonNullable<FireSimulator3DProps["risk"]>, [number, number, number]> = {
  LOW: [1.0, 0.86, 0.45],
  MODERATE: [1.0, 0.62, 0.22],
  HIGH: [1.0, 0.36, 0.12],
  CRITICAL: [1.0, 0.18, 0.05],
};

const DEFAULT_LANDMARKS: Landmark[] = [
  { x: -8, z: -10, label: "Pollock Pines", kind: "city" },
  { x: 12, z: -6, label: "Camino", kind: "city" },
  { x: -14, z: 6, label: "Sly Park Reservoir", kind: "water" },
  { x: 6, z: 14, label: "US-50", kind: "highway" },
  { x: 14, z: 12, label: "Carson Ridge", kind: "ridge" },
];

// ─────────────── Terrain heightmap ───────────────

// Pseudo-random for the procedural terrain — deterministic, no extra deps.
function smoothNoise(x: number, z: number): number {
  // Multi-octave value-noise replacement via summed sines + a coarser low.
  return (
    0.55 * Math.sin(x * 0.9 + Math.cos(z * 0.7) * 1.4) +
    0.32 * Math.cos(z * 1.3 + x * 0.4) +
    0.22 * Math.sin((x + z) * 1.7) +
    0.14 * Math.sin(x * 3.2 + z * 2.6) +
    0.08 * Math.cos(z * 5.1 - x * 4.0)
  );
}

function buildHeightmap(): Float32Array {
  const h = new Float32Array(TERRAIN_RES * TERRAIN_RES);
  for (let j = 0; j < TERRAIN_RES; j++) {
    for (let i = 0; i < TERRAIN_RES; i++) {
      const x = (i / (TERRAIN_RES - 1)) * 2 - 1; // [-1, 1]
      const z = (j / (TERRAIN_RES - 1)) * 2 - 1;
      const r = Math.sqrt(x * x + z * z);
      // Layered terrain: ridge in the south, valley to the east, fire in
      // a small basin at the center. The exp() depression at center keeps
      // the fire visually sunk into the landscape.
      const ridges = smoothNoise(x * 1.2, z * 1.2) * 0.45;
      const fineDetail = smoothNoise(x * 4.0, z * 4.0) * 0.08;
      const slopeBias = z * 0.18; // tilt north-low / south-high
      const fireBasin = -0.52 * Math.exp(-r * 1.4);
      h[j * TERRAIN_RES + i] = ridges + fineDetail + slopeBias + fireBasin;
    }
  }
  return h;
}

// ─────────────── Fire-spread CA on the GROUND ───────────────

function buildFireGrid(): Float32Array {
  const g = new Float32Array(TERRAIN_RES * TERRAIN_RES);
  const c = Math.floor(TERRAIN_RES / 2);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      g[(c + dy) * TERRAIN_RES + (c + dx)] = 0.85;
    }
  }
  return g;
}

/** Optional per-cell wind sampler (in scene units - windX east, windZ south). */
type WindCellSampler = (i: number, j: number) => { windX: number; windZ: number };

function stepFire(
  grid: Float32Array,
  windX: number,
  windZ: number,
  rng: () => number,
  sampleCellWind?: WindCellSampler,
): void {
  const next = new Float32Array(grid.length);
  // Uniform-fallback magnitudes used when no per-cell sampler is supplied.
  const wMag = Math.min(0.55, Math.hypot(windX, windZ) * 0.04);
  const wxNorm = wMag === 0 ? 0 : (windX / Math.hypot(windX, windZ)) || 0;
  const wzNorm = wMag === 0 ? 0 : (windZ / Math.hypot(windX, windZ)) || 0;
  for (let j = 1; j < TERRAIN_RES - 1; j++) {
    for (let i = 1; i < TERRAIN_RES - 1; i++) {
      const idx = j * TERRAIN_RES + i;
      const cur = grid[idx]!;
      if (cur >= 1.0) {
        next[idx] = 1.0;
        continue;
      }
      // When a spatial wind grid is supplied, each cell pulls its OWN
      // (windX, windZ) - that's what gives the ground fire a
      // spatially-varying spread direction and recovers the field
      // structure the dispatcher needs to plan against.
      let cwxNorm = wxNorm;
      let cwzNorm = wzNorm;
      let cwMag = wMag;
      if (sampleCellWind) {
        const cw = sampleCellWind(i, j);
        const mag = Math.hypot(cw.windX, cw.windZ);
        cwMag = Math.min(0.55, mag * 0.04);
        cwxNorm = mag === 0 ? 0 : cw.windX / mag;
        cwzNorm = mag === 0 ? 0 : cw.windZ / mag;
      }
      let influence = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const n = grid[(j + dy) * TERRAIN_RES + (i + dx)]!;
          if (n <= 0 || n >= 1) continue;
          const len = Math.hypot(dx, dy);
          const align = -((dx / len) * cwxNorm + (dy / len) * cwzNorm);
          const weight = 0.55 + 0.45 * Math.max(-0.4, align);
          influence += n * weight * (0.5 + cwMag);
        }
      }
      const ignitePressure = influence / 8;
      let nv = cur;
      if (cur === 0 && ignitePressure > 0.18 + rng() * 0.06) {
        nv = 0.45 + rng() * 0.2;
      } else if (cur > 0 && cur < 1) {
        nv = Math.min(1.0, cur + 0.018 + rng() * 0.012);
      }
      next[idx] = nv;
    }
  }
  grid.set(next);
}

function fireGridToTexture(grid: Float32Array): THREE.DataTexture {
  const data = new Uint8Array(TERRAIN_RES * TERRAIN_RES * 4);
  for (let i = 0; i < grid.length; i++) {
    const v = grid[i]!;
    if (v === 0) {
      data[i * 4] = 0;
      data[i * 4 + 1] = 0;
      data[i * 4 + 2] = 0;
      data[i * 4 + 3] = 0;
    } else if (v < 1) {
      data[i * 4] = Math.round(255 * (1 - v * 0.5));
      data[i * 4 + 1] = Math.round(255 * 0.45 * (1 - v));
      data[i * 4 + 2] = Math.round(255 * 0.05);
      data[i * 4 + 3] = 230;
    } else {
      data[i * 4] = 30;
      data[i * 4 + 1] = 18;
      data[i * 4 + 2] = 12;
      data[i * 4 + 3] = 230;
    }
  }
  const tex = new THREE.DataTexture(data, TERRAIN_RES, TERRAIN_RES, THREE.RGBAFormat);
  tex.flipY = false;
  tex.needsUpdate = true;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

function Terrain({
  fireGridRef,
  windDirDeg,
  windSpeedMs,
  demHeightmap,
  cellWindSampler,
}: {
  fireGridRef: React.MutableRefObject<Float32Array>;
  windDirDeg: number;
  windSpeedMs: number;
  demHeightmap?: Float32Array | null;
  cellWindSampler?: WindCellSampler;
}) {
  const fireMatRef = useRef<THREE.MeshBasicMaterial>(null!);
  const stepCounter = useRef(0);
  const rngState = useRef(1);
  const rng = useMemo(
    () => () => {
      let t = (rngState.current += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    [],
  );

  // Prefer the supplied real-world DEM (AWS Terrain Tiles) when its
  // resolution matches the scene mesh. Fall back to the procedural
  // sine-noise heightmap when no DEM is provided or it has the wrong
  // length - the scene must always render even if the live fetch fails.
  const heightmap = useMemo<Float32Array>(() => {
    const expected = TERRAIN_RES * TERRAIN_RES;
    if (demHeightmap && demHeightmap.length === expected) {
      return demHeightmap;
    }
    return buildHeightmap();
  }, [demHeightmap]);
  const terrainGeo = useMemo(() => {
    const geo = new THREE.PlaneGeometry(
      TERRAIN_SIZE,
      TERRAIN_SIZE,
      TERRAIN_RES - 1,
      TERRAIN_RES - 1,
    );
    const pos = geo.attributes.position!;
    for (let i = 0; i < pos.count; i++) {
      pos.setZ(i, heightmap[i]!);
    }
    geo.computeVertexNormals();
    return geo;
  }, [heightmap]);

  const fireGeo = useMemo(() => {
    const geo = terrainGeo.clone();
    const pos = geo.attributes.position!;
    for (let i = 0; i < pos.count; i++) {
      pos.setZ(i, heightmap[i]! + 0.005);
    }
    return geo;
  }, [heightmap, terrainGeo]);

  const initialTex = useMemo(() => fireGridToTexture(fireGridRef.current), [fireGridRef]);

  useFrame((_, dt) => {
    stepCounter.current += dt;
    if (stepCounter.current >= 0.08) {
      stepCounter.current = 0;
      const windRad = (windDirDeg * Math.PI) / 180;
      const windX = Math.sin(windRad) * windSpeedMs;
      const windZ = -Math.cos(windRad) * windSpeedMs;
      stepFire(fireGridRef.current, windX, windZ, rng, cellWindSampler);
      const tex = fireGridToTexture(fireGridRef.current);
      if (fireMatRef.current) {
        fireMatRef.current.map?.dispose();
        fireMatRef.current.map = tex;
        fireMatRef.current.needsUpdate = true;
      }
    }
  });

  return (
    <group rotation={[-Math.PI / 2, 0, 0]}>
      <mesh geometry={terrainGeo} receiveShadow>
        <meshStandardMaterial color="#1a1a1a" roughness={0.95} metalness={0} flatShading />
      </mesh>
      <mesh geometry={fireGeo}>
        <meshBasicMaterial
          ref={fireMatRef}
          map={initialTex}
          transparent
          opacity={0.95}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

// ─────────────── Embers + smoke ───────────────

function Embers({
  windDirDeg,
  windSpeedMs,
  riskColor,
  count,
  cellWindSampler,
}: {
  windDirDeg: number;
  windSpeedMs: number;
  riskColor: [number, number, number];
  count: number;
  cellWindSampler?: WindCellSampler;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const state = useMemo(
    () =>
      new Array(count).fill(null).map(() => ({
        x: (Math.random() - 0.5) * 0.4,
        y: Math.random() * 0.2,
        z: (Math.random() - 0.5) * 0.4,
        vy: 0.3 + Math.random() * 0.6,
        life: Math.random(),
        ttl: 1.4 + Math.random() * 2.0,
      })),
    [count],
  );
  const windRad = (windDirDeg * Math.PI) / 180;
  const wScale = Math.min(0.55, windSpeedMs * 0.06);
  const windX = Math.sin(windRad) * wScale;
  const windZ = -Math.cos(windRad) * wScale;
  useFrame((_, dt) => {
    if (!meshRef.current) return;
    for (let i = 0; i < count; i++) {
      const p = state[i];
      if (!p) continue;
      p.life += dt;
      if (p.life > p.ttl) {
        p.x = (Math.random() - 0.5) * 0.4;
        p.y = 0.05;
        p.z = (Math.random() - 0.5) * 0.4;
        p.vy = 0.3 + Math.random() * 0.7;
        p.life = 0;
        p.ttl = 1.4 + Math.random() * 2.2;
      }
      // When a spatial wind grid is supplied, each ember pulls the wind
      // vector at its OWN scene-space (x,z) so embers near the eastern
      // ridge drift differently than ones above the valley.
      let pWindX = windX;
      let pWindZ = windZ;
      if (cellWindSampler) {
        const ci = Math.max(
          0,
          Math.min(TERRAIN_RES - 1, Math.round(((p.x / TERRAIN_SIZE) + 0.5) * (TERRAIN_RES - 1))),
        );
        const cj = Math.max(
          0,
          Math.min(TERRAIN_RES - 1, Math.round(((p.z / TERRAIN_SIZE) + 0.5) * (TERRAIN_RES - 1))),
        );
        const cw = cellWindSampler(ci, cj);
        pWindX = cw.windX * 0.06;
        pWindZ = cw.windZ * 0.06;
      }
      p.x += pWindX * dt;
      p.z += pWindZ * dt;
      p.y += p.vy * dt;
      p.vy *= 1 - dt * 0.4;
      const t = p.life / p.ttl;
      const scale = (1 - t) * 0.05 + 0.015;
      dummy.position.set(p.x, p.y, p.z);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
      const fade = 1 - t;
      meshRef.current.setColorAt(
        i,
        new THREE.Color(riskColor[0] * fade + 0.05 * t, riskColor[1] * fade, riskColor[2] * fade),
      );
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true;
  });
  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
      <sphereGeometry args={[1, 6, 6]} />
      <meshBasicMaterial
        transparent
        opacity={0.85}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </instancedMesh>
  );
}

function SmokeColumn({ windDirDeg, windSpeedMs }: { windDirDeg: number; windSpeedMs: number }) {
  const group = useRef<THREE.Group>(null!);
  const layers = 6;
  const windRad = (windDirDeg * Math.PI) / 180;
  const drift = Math.min(2.0, windSpeedMs * 0.18);
  useFrame(({ clock }) => {
    if (!group.current) return;
    const t = clock.getElapsedTime();
    group.current.children.forEach((c, i) => {
      const phase = i / layers;
      c.position.set(
        Math.sin(windRad) * drift * phase + Math.sin(t + i) * 0.05,
        0.3 + i * 0.5 + Math.sin(t * 0.6 + i) * 0.04,
        -Math.cos(windRad) * drift * phase + Math.cos(t + i) * 0.05,
      );
    });
  });
  return (
    <group ref={group}>
      {Array.from({ length: layers }).map((_, i) => (
        <mesh key={i}>
          <sphereGeometry args={[0.45 + i * 0.16, 12, 12]} />
          <meshBasicMaterial
            color="#1c1c1f"
            transparent
            opacity={0.16 - i * 0.018}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}

function SpreadRings({
  predicted1hAcres,
  predicted6hAcres,
  predicted24hAcres,
}: {
  predicted1hAcres?: number;
  predicted6hAcres?: number;
  predicted24hAcres?: number;
}) {
  const ringFor = (acres: number | undefined) => {
    if (!acres || acres <= 0) return null;
    const radiusM = Math.sqrt((acres * 4047) / Math.PI);
    return radiusM / 125;
  };
  const r1 = ringFor(predicted1hAcres);
  const r6 = ringFor(predicted6hAcres);
  const r24 = ringFor(predicted24hAcres);
  return (
    <group rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
      {r1 !== null && (
        <mesh>
          <ringGeometry args={[r1 * 0.95, r1, 64]} />
          <meshBasicMaterial color="#fde68a" transparent opacity={0.5} side={THREE.DoubleSide} />
        </mesh>
      )}
      {r6 !== null && (
        <mesh>
          <ringGeometry args={[r6 * 0.97, r6, 64]} />
          <meshBasicMaterial color="#fb923c" transparent opacity={0.4} side={THREE.DoubleSide} />
        </mesh>
      )}
      {r24 !== null && (
        <mesh>
          <ringGeometry args={[r24 * 0.98, r24, 64]} />
          <meshBasicMaterial color="#dc2626" transparent opacity={0.32} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
}

// ─────────────── Landmarks ───────────────

function Landmarks({ landmarks }: { landmarks: Landmark[] }) {
  return (
    <group>
      {landmarks.map((lm, i) => (
        <Billboard key={i} position={[lm.x, 0.6, lm.z]} follow>
          <Text
            fontSize={0.4}
            color={
              lm.kind === "city"
                ? "#ffffff"
                : lm.kind === "water"
                  ? "#7dd3fc"
                  : lm.kind === "highway"
                    ? "#fde68a"
                    : "#a3a3a3"
            }
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.025}
            outlineColor="#000000"
            material-toneMapped={false}
          >
            {lm.label}
          </Text>
        </Billboard>
      ))}
      <Billboard position={[0, 1.4, 0]} follow>
        <Text
          fontSize={0.5}
          color="#fb923c"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.04}
          outlineColor="#000000"
          material-toneMapped={false}
        >
          INCIDENT
        </Text>
      </Billboard>
    </group>
  );
}

// ─────────────── Web Audio "beep" hook ───────────────
//
// Plays a short synth tone the first time a dispatched unit arrives within
// arrival-radius of the incident. AudioContext is created lazily on the
// first user gesture so we don't hit Chrome's autoplay policy. Per-unit
// throttle so a unit beeps exactly once.

function playBeep(freq = 880, durationMs = 220): void {
  try {
    const ctx = new (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durationMs / 1000);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + durationMs / 1000 + 0.05);
    osc.onended = () => ctx.close();
  } catch {
    /* no-op — AudioContext not available */
  }
}

// ─────────────── Fire-station base marker ───────────────
//
// Stays at the curve-start point even after the unit has left. Gives the
// dispatcher a "the engine came from THERE" cue while zoomed out.

function StationBase({
  position,
  name,
  color,
  isAerial,
}: {
  position: THREE.Vector3;
  name: string;
  color: string;
  isAerial: boolean;
}) {
  return (
    <group position={[position.x, isAerial ? 0.25 : 0.05, position.z]}>
      {/* Pad / helipad disk on the ground. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.32, 0.42, 24]} />
        <meshBasicMaterial color={color} transparent opacity={0.55} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
        <circleGeometry args={[0.32, 24]} />
        <meshBasicMaterial color={color} transparent opacity={0.18} />
      </mesh>
      {/* Vertical pole + dot to make the base findable from any angle. */}
      <mesh position={[0, 0.4, 0]}>
        <cylinderGeometry args={[0.02, 0.02, 0.8, 6]} />
        <meshBasicMaterial color={color} transparent opacity={0.6} />
      </mesh>
      <mesh position={[0, 0.85, 0]}>
        <sphereGeometry args={[0.06, 10, 10]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <Billboard position={[0, 1.05, 0]} follow>
        <Text
          fontSize={0.18}
          color="#e5e5e5"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.018}
          outlineColor="#000000"
          material-toneMapped={false}
        >
          {name}
        </Text>
      </Billboard>
    </group>
  );
}

// ─────────────── Animated dispatched units ───────────────

function DispatchedUnit({ res }: { res: ResourceMarker }) {
  const groupRef = useRef<THREE.Group>(null!);
  const tStart = useRef<number | null>(null);
  const beeped = useRef(false);
  const isAerial = res.kind === "helicopter" || res.kind === "fixed-wing";

  const { curve, basePos } = useMemo(() => {
    const angleRad = (res.bearingDeg * Math.PI) / 180;
    const distUnits = Math.min(18, (res.distanceKm * 1000) / 125);
    const bx = Math.sin(angleRad) * distUnits;
    const bz = -Math.cos(angleRad) * distUnits;
    const peakY = isAerial ? 3.2 : 0.4;
    const start = new THREE.Vector3(bx, isAerial ? 1.2 : 0.2, bz);
    const mid = new THREE.Vector3(bx * 0.5, peakY, bz * 0.5);
    const end = new THREE.Vector3(0, isAerial ? 0.8 : 0.15, 0);
    return {
      curve: new THREE.CatmullRomCurve3([start, mid, end], false, "catmullrom", 0.5),
      basePos: new THREE.Vector3(bx, 0, bz),
    };
  }, [res.kind, res.bearingDeg, res.distanceKm, isAerial]);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    if (tStart.current === null) tStart.current = clock.getElapsedTime();
    const sceneDuration = Math.max(4, res.etaMinutes / 4);
    const elapsed = clock.getElapsedTime() - tStart.current;
    const t = Math.min(1, elapsed / sceneDuration);
    const tEased = 1 - Math.pow(1 - t, 2.5);
    const pos = curve.getPointAt(tEased);
    groupRef.current.position.copy(pos);
    // Arrival beep: triggers once when the unit crosses ~95% of its travel.
    if (!beeped.current && t >= 0.95) {
      beeped.current = true;
      // Pitch by kind — aerial assets ping higher.
      const freq = isAerial ? 1100 : res.kind === "dozer" ? 540 : 760;
      playBeep(freq, 240);
    }
  });

  const color =
    res.kind === "helicopter"
      ? "#22d3ee"
      : res.kind === "fixed-wing"
        ? "#a78bfa"
        : res.kind === "dozer"
          ? "#fbbf24"
          : res.kind === "hand-crew"
            ? "#34d399"
            : "#60a5fa";

  const baseLabel =
    res.baseName ?? (isAerial ? `${res.kind.toUpperCase()} BASE` : "STATION");
  const unitLabel =
    res.name ?? `${res.kind.toUpperCase()}`;

  return (
    <>
      <StationBase position={basePos} name={baseLabel} color={color} isAerial={isAerial} />
      <group ref={groupRef}>
        <mesh>
          <sphereGeometry args={[isAerial ? 0.18 : 0.12, 12, 12]} />
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
        {/* Thin emissive trail dot for visibility. */}
        <pointLight color={color} intensity={1.2} distance={2.4} decay={2} />
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.06, 0]}>
          <ringGeometry args={[0, 0.22, 16]} />
          <meshBasicMaterial color={color} transparent opacity={0.35} />
        </mesh>
        <Billboard position={[0, 0.5, 0]} follow>
          <Text
            fontSize={0.22}
            color="#ffffff"
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.02}
            outlineColor="#000000"
            material-toneMapped={false}
          >
            {`${unitLabel} · ETA ${res.etaMinutes}m`}
          </Text>
        </Billboard>
      </group>
    </>
  );
}

// ─────────────── Cinematic camera intro ───────────────
//
// Camera starts wide (showing the whole 5 km × 5 km tile + landmarks +
// station bases out to ~18 units from center) and eases in to a tighter
// fire-focused view over ~2.5 s. After the intro, OrbitControls take over.

function CinematicIntro({
  durationSec = 2.5,
  startPos = new THREE.Vector3(28, 22, 28),
  endPos = new THREE.Vector3(12, 8, 14),
}: {
  durationSec?: number;
  startPos?: THREE.Vector3;
  endPos?: THREE.Vector3;
}) {
  const { camera } = useThree();
  const t0 = useRef<number | null>(null);
  // Keep the user's scroll/pan after the intro completes — we only steer
  // the camera while `done` is false.
  const done = useRef(false);

  // Initialize camera at the wide position on first frame.
  useEffect(() => {
    camera.position.copy(startPos);
    camera.lookAt(0, 0, 0);
  }, [camera, startPos]);

  useFrame(({ clock }) => {
    if (done.current) return;
    if (t0.current === null) t0.current = clock.getElapsedTime();
    const elapsed = clock.getElapsedTime() - t0.current;
    const t = Math.min(1, elapsed / durationSec);
    // Cubic ease-out per the research report.
    const eased = 1 - Math.pow(1 - t, 3);
    camera.position.lerpVectors(startPos, endPos, eased);
    camera.lookAt(0, 0, 0);
    if (t >= 1) done.current = true;
  });

  return null;
}

// ─────────────── Wind grid -> scene-space sampler ───────────────
//
// The CA + embers want a `(i, j) -> (windX, windZ)` callback in scene
// units, but the WindGrid is indexed by lat/lon. We project the grid's
// bbox onto the scene's [-TERRAIN_SIZE/2, +TERRAIN_SIZE/2] square and
// bilinear-interpolate. (i, j) here are the CA cell indices in
// [0, TERRAIN_RES). The y-axis flip matches the existing convention
// where windZ < 0 means "blowing north" (toward -Z).

function makeCellSamplerFromWindGrid(grid: WindGrid): WindCellSampler {
  const [rows, cols] = grid.gridDims;
  const u = grid.uMs;
  const v = grid.vMs;
  return (i: number, j: number) => {
    // Map CA cell (i, j) in [0, TERRAIN_RES) to grid index space.
    const fx = i / (TERRAIN_RES - 1);
    const fy = j / (TERRAIN_RES - 1);
    const gx = Math.max(0, Math.min(cols - 1, fx * (cols - 1)));
    const gy = Math.max(0, Math.min(rows - 1, fy * (rows - 1)));
    const x0 = Math.floor(gx);
    const x1 = Math.min(cols - 1, x0 + 1);
    const y0 = Math.floor(gy);
    const y1 = Math.min(rows - 1, y0 + 1);
    const dx = gx - x0;
    const dy = gy - y0;
    const idx = (jj: number, ii: number): number => jj * cols + ii;
    const lerp = (a00: number, a10: number, a01: number, a11: number): number =>
      a00 * (1 - dx) * (1 - dy) +
      a10 * dx * (1 - dy) +
      a01 * (1 - dx) * dy +
      a11 * dx * dy;
    const uVal = lerp(u[idx(y0, x0)]!, u[idx(y0, x1)]!, u[idx(y1, x0)]!, u[idx(y1, x1)]!);
    const vVal = lerp(v[idx(y0, x0)]!, v[idx(y0, x1)]!, v[idx(y1, x0)]!, v[idx(y1, x1)]!);
    // Convention: windX east-positive, windZ south-positive -> north is -Z.
    // u is east-positive (matches), v is north-positive -> flip sign for Z.
    return { windX: uVal, windZ: -vVal };
  };
}

// ─────────────── Wind streamlines overlay ───────────────
//
// Subtle <Line> segments along each wind-grid cell's local vector so the
// dispatcher can read the field structure at a glance. Opacity 0.25 keeps
// it under the fire visuals.

function WindStreamlines({ windGrid }: { windGrid: WindGrid }) {
  const segments = useMemo(() => {
    const [rows, cols] = windGrid.gridDims;
    const out: { from: [number, number, number]; to: [number, number, number] }[] = [];
    const half = TERRAIN_SIZE / 2;
    const yPlane = 0.06;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const fx = cols === 1 ? 0.5 : i / (cols - 1);
        const fy = rows === 1 ? 0.5 : j / (rows - 1);
        const x = -half + fx * TERRAIN_SIZE;
        const z = -half + fy * TERRAIN_SIZE;
        const u = windGrid.uMs[j * cols + i] ?? 0;
        const v = windGrid.vMs[j * cols + i] ?? 0;
        const mag = Math.hypot(u, v);
        if (mag < 0.05) continue;
        const len = Math.min(1.6, 0.4 + mag * 0.18);
        const dx = (u / mag) * len;
        const dz = (-v / mag) * len; // flip for scene Z convention
        out.push({ from: [x, yPlane, z], to: [x + dx, yPlane, z + dz] });
      }
    }
    return out;
  }, [windGrid]);

  return (
    <group>
      {segments.map((s, i) => (
        <Line
          key={i}
          points={[s.from, s.to]}
          color="#7dd3fc"
          lineWidth={1.4}
          transparent
          opacity={0.25}
        />
      ))}
    </group>
  );
}

// ─────────────── Main scene ───────────────

export function FireSimulator3D({
  windDirDeg,
  windSpeedMs,
  predicted1hAcres,
  predicted6hAcres,
  predicted24hAcres,
  risk = "MODERATE",
  resources = [],
  landmarks = DEFAULT_LANDMARKS,
  lowDetail = false,
  demHeightmap = null,
  windGrid = null,
  showWindStreamlines,
}: FireSimulator3DProps) {
  const fireGridRef = useRef<Float32Array>(buildFireGrid());
  const riskColor = RISK_COLORS[risk];
  const emberCount = lowDetail ? 1500 : 3500;
  const cellSampler = useMemo(
    () => (windGrid ? makeCellSamplerFromWindGrid(windGrid) : undefined),
    [windGrid],
  );
  const renderStreamlines = showWindStreamlines ?? Boolean(windGrid);

  return (
    <div className="relative h-full w-full bg-black">
      <Canvas
        camera={{ position: [28, 22, 28], fov: 45, near: 0.1, far: 200 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: false }}
      >
        <color attach="background" args={["#000000"]} />
        <ambientLight intensity={0.32} />
        <directionalLight position={[8, 10, 5]} intensity={0.6} />
        <pointLight
          position={[0, 0.6, 0]}
          color={new THREE.Color(riskColor[0], riskColor[1], riskColor[2])}
          intensity={2.5}
          distance={10}
        />
        <Stars radius={70} depth={50} count={1000} factor={1.6} fade speed={0.3} />

        {/* Cinematic intro: pulls in from a 28/22/28 wide region view to a
            12/8/14 fire-focused view over 2.5s on mount. After the intro
            completes, OrbitControls take full ownership. */}
        <CinematicIntro />

        <Terrain
          fireGridRef={fireGridRef}
          windDirDeg={windDirDeg}
          windSpeedMs={windSpeedMs}
          demHeightmap={demHeightmap}
          cellWindSampler={cellSampler}
        />
        <SpreadRings
          predicted1hAcres={predicted1hAcres}
          predicted6hAcres={predicted6hAcres}
          predicted24hAcres={predicted24hAcres}
        />
        {windGrid && renderStreamlines ? <WindStreamlines windGrid={windGrid} /> : null}
        <Embers
          windDirDeg={windDirDeg}
          windSpeedMs={windSpeedMs}
          riskColor={riskColor}
          count={emberCount}
          cellWindSampler={cellSampler}
        />
        <SmokeColumn windDirDeg={windDirDeg} windSpeedMs={windSpeedMs} />
        <Landmarks landmarks={landmarks} />
        {resources.map((r) => (
          <DispatchedUnit key={r.id} res={r} />
        ))}

        <OrbitControls
          enablePan
          enableZoom
          enableRotate
          minDistance={5}
          maxDistance={45}
          maxPolarAngle={Math.PI / 2.05}
        />
      </Canvas>
    </div>
  );
}
