import * as THREE from 'three';
import { type DriveInput, type Excavator, MACHINE_SCALE } from './excavator';
import { SWING_Y, groundReach, inverse, clamp } from './kinematics';
import { REST_POSE } from './excavator';

/* ───────────── キーボード ───────────── */

export class Keys {
  private down = new Set<string>();
  /** 押した瞬間の 1 回だけ true を返すキー */
  private pressed = new Set<string>();

  constructor() {
    addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code))
        e.preventDefault();
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => this.down.clear());
  }

  held(code: string): boolean {
    return this.down.has(code);
  }

  /** 押した瞬間だけ true（読むと消える） */
  tap(code: string): boolean {
    return this.pressed.delete(code);
  }

  get any(): boolean {
    return this.down.size > 0;
  }

  axis(neg: string[], pos: string[]): number {
    const f = (codes: string[]) => (codes.some((c) => this.down.has(c)) ? 1 : 0);
    return f(pos) - f(neg);
  }

  read(): DriveInput {
    return {
      drive: this.axis(['KeyS'], ['KeyW']),
      turn: this.axis(['KeyA'], ['KeyD']),
      swing: this.axis(['ArrowRight'], ['ArrowLeft']),
      boom: this.axis(['ArrowDown'], ['ArrowUp']),
      stick: this.axis(['KeyE'], ['KeyQ']),
      bucket: this.axis(['KeyZ'], ['KeyX']),
    };
  }
}

export const isActive = (i: DriveInput) =>
  i.drive !== 0 || i.turn !== 0 || i.swing !== 0 || i.boom !== 0 || i.stick !== 0 || i.bucket !== 0;

/* ───────────── カメラ ───────────── */

export class CameraRig {
  yaw = 0.9;
  pitch = 0.36;
  dist = 62;
  private readonly focus = new THREE.Vector3();
  private shake = 0;
  private time = 0;
  private readonly off = new THREE.Vector3();

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  orbit(dx: number, dy: number) {
    this.yaw -= dx * 0.0052;
    this.pitch = clamp(this.pitch + dy * 0.0042, 0.04, 1.35);
  }

  zoom(delta: number) {
    this.dist = clamp(this.dist * Math.exp(delta * 0.0012), 20, 190);
  }

  addShake(a: number) {
    this.shake = Math.min(1.2, this.shake + a);
  }

  snapTo(target: THREE.Vector3) {
    this.focus.copy(target);
  }

  update(dt: number, target: THREE.Vector3) {
    this.time += dt;
    this.focus.lerp(target, 1 - Math.exp(-4.5 * dt));
    const cp = Math.cos(this.pitch);
    this.off
      .set(Math.cos(this.yaw) * cp, Math.sin(this.pitch), Math.sin(this.yaw) * cp)
      .multiplyScalar(this.dist);
    this.camera.position.copy(this.focus).add(this.off);
    this.camera.position.y = Math.max(2.2, this.camera.position.y);
    this.camera.lookAt(this.focus);
    this.shake *= Math.exp(-5.5 * dt);
    if (this.shake > 0.002) {
      const s = this.shake * 0.9;
      this.camera.position.x += (Math.sin(this.time * 61) + Math.sin(this.time * 37.3)) * 0.5 * s;
      this.camera.position.y += (Math.sin(this.time * 53.7) + Math.cos(this.time * 41)) * 0.5 * s;
      this.camera.position.z += (Math.cos(this.time * 47) + Math.sin(this.time * 29.1)) * 0.5 * s;
      this.camera.rotateZ(Math.sin(this.time * 33) * s * 0.004);
    }
  }
}

/* ───────────── クリックで粉砕（自動操縦） ───────────── */

type Phase = 'idle' | 'approach' | 'aim' | 'strike' | 'sweep' | 'recover';

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class Autopilot {
  phase: Phase = 'idle';
  private t = 0;
  private readonly target = new THREE.Vector3();
  private sweepDir = 1;
  private readonly reach = groundReach();
  private readonly tmp = new THREE.Vector3();

  get active(): boolean {
    return this.phase !== 'idle';
  }

  /** 目標地点 p（ワールド）へ向かい、叩き壊す */
  start(p: THREE.Vector3) {
    this.target.copy(p);
    this.target.y = Math.max(p.y, 0.5);
    this.phase = 'approach';
    this.t = 0;
    this.sweepDir = Math.random() < 0.5 ? -1 : 1;
  }

  cancel(ex: Excavator) {
    if (this.phase === 'idle') return;
    this.phase = 'idle';
    ex.resetJointFeel();
  }

  /** 走行の指示（drive/turn）を返す。腕の関節は直接 ex に指示する */
  update(dt: number, ex: Excavator): { drive: number; turn: number } | null {
    if (this.phase === 'idle') return null;
    this.t += dt;
    const S = MACHINE_SCALE;
    const pivot = ex.swingPivot(this.tmp);
    const dx = this.target.x - pivot.x;
    const dz = this.target.z - pivot.z;
    // 以降の距離・高さは、機体のローカル単位（拡大前）で扱う
    const dh = Math.hypot(dx, dz) / S;
    const desired = Math.atan2(-dz, dx);
    const headErr = wrap(desired - ex.heading);
    const ty = (this.target.y - pivot.y) / S;
    // 高い目標ほど、腕を立てる分だけ近づく
    const stopDist = clamp(20 - Math.max(0, this.target.y / S) * 0.35, 13, 21);
    const nearLimit = Math.max(this.reach.min + 3, 11);
    const swingRel = wrap(desired - ex.heading);

    if (this.phase === 'approach') {
      // 移動中は腕を畳んで、目標の方を向ける
      ex.setTargets(
        {
          swing: clamp(swingRel, -1.4, 1.4),
          boom: REST_POSE.boom,
          stick: REST_POSE.stick,
          bucket: REST_POSE.bucket,
        },
        5,
        1.4
      );
      if (dh > stopDist + 1.2) {
        const turn = clamp(-headErr * 2.2, -1, 1);
        const drive = Math.abs(headErr) > 0.9 ? 0 : 1 - Math.abs(headErr) * 0.6;
        return { drive, turn };
      }
      if (dh < nearLimit) {
        return { drive: -0.7, turn: clamp(-headErr * 0.8, -0.5, 0.5) };
      }
      this.phase = 'aim';
      this.t = 0;
    }

    if (this.phase === 'aim') {
      // 振りかぶり: 目標の上方・手前に刃先を持ち上げる
      const d = clamp(dh, nearLimit, 27);
      const wind = inverse({ x: Math.max(7, d - 4.5), y: Math.max(ty + 7.5, 7) }, -0.75);
      ex.setTargets(
        {
          swing: clamp(swingRel, -2.4, 2.4),
          boom: wind.boom,
          stick: wind.stick,
          bucket: wind.bucket,
        },
        6.5,
        1.8
      );
      if (this.t > 0.85 && Math.abs(ex.joints.swing.target - ex.joints.swing.angle) < 0.08) {
        this.phase = 'strike';
        this.t = 0;
        const d2 = clamp(dh + 2.4, nearLimit, 29);
        const hit = inverse({ x: d2, y: Math.max(ty - 0.6, -SWING_Y + 0.5) }, -1.05);
        ex.setTargets({ boom: hit.boom, stick: hit.stick, bucket: hit.bucket }, 26, 4.6);
      }
      return { drive: 0, turn: 0 };
    }

    if (this.phase === 'strike') {
      if (this.t > 0.55) {
        this.phase = 'sweep';
        this.t = 0;
        ex.setTargets({ swing: ex.joints.swing.angle + this.sweepDir * 0.95 }, 9, 1.6);
      }
      return { drive: 0, turn: 0 };
    }

    if (this.phase === 'sweep') {
      if (this.t > 0.75) {
        this.phase = 'recover';
        this.t = 0;
        ex.setTargets(
          { boom: REST_POSE.boom + 0.25, stick: REST_POSE.stick, bucket: REST_POSE.bucket },
          5,
          1.5
        );
      }
      return { drive: 0, turn: 0 };
    }

    if (this.phase === 'recover') {
      if (this.t > 1.0) {
        this.phase = 'idle';
        ex.resetJointFeel();
      }
      return { drive: 0, turn: 0 };
    }
    return null;
  }
}

/* ───────────── ポインタ（視点操作・クリック） ───────────── */

export interface PointerHooks {
  /** クリック（ドラッグしていない）されたとき。ndc は -1..1 */
  onClick(ndcX: number, ndcY: number): void;
  onMove(ndcX: number, ndcY: number): void;
}

export function bindPointer(
  el: HTMLElement,
  rig: CameraRig,
  hooks: PointerHooks,
  onFirstGesture: () => void
) {
  const pts = new Map<number, { x: number; y: number }>();
  let startT = 0;
  let moved = 0;
  let pinch = 0;

  const ndc = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * 2 - 1,
      y: -(((e.clientY - r.top) / r.height) * 2 - 1),
    };
  };

  el.addEventListener('pointerdown', (e) => {
    onFirstGesture();
    el.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) {
      startT = performance.now();
      moved = 0;
    }
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      moved = 999;
    }
  });
  el.addEventListener('pointermove', (e) => {
    const n = ndc(e);
    hooks.onMove(n.x, n.y);
    const p = pts.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pts.size === 1) {
      moved += Math.abs(dx) + Math.abs(dy);
      rig.orbit(dx, dy);
    } else if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      rig.zoom((pinch - d) * 2.2);
      pinch = d;
    }
  });
  const up = (e: PointerEvent) => {
    if (pts.has(e.pointerId) && pts.size === 1 && moved < 7 && performance.now() - startT < 450) {
      const n = ndc(e);
      hooks.onClick(n.x, n.y);
    }
    pts.delete(e.pointerId);
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', (e) => pts.delete(e.pointerId));
  el.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      rig.zoom(e.deltaY);
    },
    { passive: false }
  );
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}
