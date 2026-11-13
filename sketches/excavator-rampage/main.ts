import '../../src/base.css';
import './style.css';
import * as THREE from 'three';
import { Sfx } from './audio';
import { HALF } from './config';
import { Autopilot, CameraRig, Keys, bindPointer, isActive } from './controls';
import { Environment, TIMES, TIME_LABEL, type TimeOfDay } from './environment';
import { type DriveInput, Excavator, MACHINE_SCALE } from './excavator';
import { PostFX } from './postfx';
import { City, QUALITY_HIGH, QUALITY_LOW, type WorldBox } from './world';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const KEY = (s: string) => `sketch:excavator-rampage:${s}`;
const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(KEY(k));
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(KEY(k), v);
    } catch {
      /* 保存できなくても動かす */
    }
  },
};

const canvas = $<HTMLCanvasElement>('stage');
const params = new URLSearchParams(location.search);

function boot() {
  const gl = canvas.getContext('webgl2', { antialias: false, powerPreference: 'high-performance' });
  if (!gl) {
    $('loading').hidden = true;
    $('nogl').hidden = false;
    return;
  }
  const renderer = new THREE.WebGLRenderer({ canvas, context: gl });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  // 画質: 指やタッチ中心の端末・非力な環境では軽くする
  const coarse =
    matchMedia('(pointer: coarse)').matches || (navigator.hardwareConcurrency ?? 8) <= 4;
  const structural =
    params.get('q') === 'low' || (params.get('q') !== 'high' && coarse)
      ? QUALITY_LOW
      : QUALITY_HIGH;
  let effectsHigh = params.has('fx')
    ? params.get('fx') === 'high'
    : store.get('quality')
      ? store.get('quality') === 'high'
      : !coarse;
  const maxDpr = () => (effectsHigh ? Math.min(devicePixelRatio, 2) : 1);
  let pixelRatio = Math.min(maxDpr(), 1.5);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, 1, 0.5, 6000);

  const city = new City(structural, params.has('seed') ? Number(params.get('seed')) : undefined);
  scene.add(city.group);
  const env = new Environment(renderer, scene, city.facade);
  const ex = new Excavator();
  scene.add(ex.root);
  ex.root.traverse((o) => {
    o.frustumCulled = false;
  });

  // 開始位置: 手前の広場。街の中心へ向く
  ex.x = 0;
  ex.z = HALF - 40;
  ex.heading = Math.PI / 2;

  const post = new PostFX(renderer, scene, camera);
  const rig = new CameraRig(camera);
  rig.yaw = Math.PI / 2 + 0.75;
  rig.dist = 84;
  rig.snapTo(new THREE.Vector3(ex.x, 7 * MACHINE_SCALE, ex.z));
  const keys = new Keys();
  const auto = new Autopilot();
  const sfx = new Sfx(KEY('muted'));

  // ── 時間帯・画質・音
  let timeIdx = Math.max(0, TIMES.indexOf((store.get('time') as TimeOfDay) ?? 'dusk'));
  if (params.has('time')) timeIdx = Math.max(0, TIMES.indexOf(params.get('time') as TimeOfDay));
  const applyTime = () => {
    const t = TIMES[timeIdx]!;
    env.setTime(t);
    post.setBloom(env.bloom.strength, env.bloom.radius, env.bloom.threshold);
    ex.setLights(env.lamps);
    city.props.setLampLevel(env.lamps);
    $('time-label').textContent = TIME_LABEL[t];
    store.set('time', t);
  };
  const applyQuality = () => {
    post.setEnabled(effectsHigh);
    env.setShadowSize(effectsHigh ? 4096 : 2048);
    $('quality-label').textContent = effectsHigh ? '高' : '低';
    store.set('quality', effectsHigh ? 'high' : 'low');
    pixelRatio = Math.min(pixelRatio, maxDpr());
    resize();
  };
  const applySound = () => {
    $('sound-label').textContent = sfx.muted ? 'OFF' : 'ON';
    $('btn-sound').setAttribute('aria-pressed', String(!sfx.muted));
  };

  const resize = () => {
    const w = innerWidth;
    const h = innerHeight;
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(w, h, false);
    post.setSize(w, h, pixelRatio);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  addEventListener('resize', resize);

  $('btn-time').addEventListener('click', () => {
    timeIdx = (timeIdx + 1) % TIMES.length;
    applyTime();
  });
  $('btn-quality').addEventListener('click', () => {
    effectsHigh = !effectsHigh;
    applyQuality();
  });
  $('btn-sound').addEventListener('click', () => {
    sfx.start();
    sfx.setMuted(!sfx.muted);
    applySound();
  });
  const help = $('help');
  const toggleHelp = () => help.classList.toggle('closed');
  $('btn-help').addEventListener('click', toggleHelp);
  if (matchMedia('(max-width: 720px)').matches) help.classList.add('closed');

  // ── 照準
  const reticle = $('reticle');
  let ndc = { x: 0, y: 0 };
  let hasPointer = false;
  const ray = new THREE.Raycaster();
  const pick = (nx: number, ny: number): THREE.Vector3 | null => {
    ray.setFromCamera(new THREE.Vector2(nx, ny), camera);
    return city.raycast(ray.ray.origin, ray.ray.direction);
  };
  const smashAt = (nx: number, ny: number) => {
    const p = pick(nx, ny);
    if (p) auto.start(p);
  };
  bindPointer(
    canvas,
    rig,
    {
      onClick: (x, y) => smashAt(x, y),
      onMove: (x, y) => {
        ndc = { x, y };
        hasPointer = true;
      },
    },
    () => sfx.start()
  );

  // ── 衝撃 → 音と画面揺れ
  const camPos = new THREE.Vector3();
  city.onImpact = (e) => {
    camPos.copy(camera.position);
    const dist = Math.hypot(e.x - camPos.x, e.y - camPos.y, e.z - camPos.z);
    const near = Math.max(0, 1 - dist / 170);
    const strength = Math.min(1, (e.speed * Math.sqrt(e.size)) / 38);
    if (strength > 0.3) {
      sfx.thud(strength, near);
      rig.addShake(strength * near * 0.35);
    } else if (strength > 0.08) {
      sfx.clatter(strength * 3, near);
    }
  };
  city.onCollapse = (x, z, cells) => {
    const dist = Math.hypot(x - camera.position.x, z - camera.position.z);
    const near = Math.max(0, 1 - dist / 220);
    const s = Math.min(1, cells / 220);
    sfx.rumble(s, near);
    rig.addShake(s * near * 0.9);
  };

  // ── 地面の目印（クリック先）
  let reticleTimer = 0;

  // ── 作業用
  const box: WorldBox = {
    center: new THREE.Vector3(),
    ax: new THREE.Vector3(),
    ay: new THREE.Vector3(),
    az: new THREE.Vector3(),
    half: new THREE.Vector3(),
  };
  const sunColor = new THREE.Color();
  const ambient = new THREE.Color();
  const focus = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  let lastTread = { x: ex.x, z: ex.z };
  let dustTimer = 0;
  let loadAvg = 0;
  let hudTimer = 0;
  let frames = 0;
  let fps = 0;
  let fpsTime = 0;
  let slowMs = 0;
  let fastMs = 0;
  let time = 0;
  let armMotion = 0;

  const hud = {
    pct: $('pct'),
    bar: $('pct-bar'),
    down: $('down'),
    bld: $('bld'),
    fps: $('fps'),
  };
  hud.bld.textContent = String(city.stats.buildings);

  function frame(dt: number, draw = true) {
    time += dt;
    // 1) 入力
    if (keys.tap('KeyT')) {
      timeIdx = (timeIdx + 1) % TIMES.length;
      applyTime();
    }
    if (keys.tap('KeyG')) {
      effectsHigh = !effectsHigh;
      applyQuality();
    }
    if (keys.tap('KeyM')) {
      sfx.start();
      sfx.setMuted(!sfx.muted);
      applySound();
    }
    if (keys.tap('KeyH')) toggleHelp();
    if (keys.tap('Space') && hasPointer) smashAt(ndc.x, ndc.y);

    let input: DriveInput = keys.read();
    if (isActive(input)) {
      sfx.start();
      auto.cancel(ex);
    }
    const ap = auto.update(dt, ex);
    if (ap) input = { ...input, drive: ap.drive, turn: ap.turn };

    // 2) 機体の更新
    ex.update(dt, input, city.bounds);

    // 3) 当たり判定: 触れたセルを壊す
    let bodyHits = 0;
    let armHits = 0;
    for (const vol of ex.volumes) {
      ex.worldBox(vol, box);
      const n = city.smashBox(box, ex.velocityOf(vol, dt), {
        kick: vol.kick,
        margin: vol.kick ? 0.7 : 0.5,
      });
      if (
        vol.name.startsWith('arm') ||
        vol.name === 'bucket' ||
        vol.name === 'stick' ||
        vol.name === 'boom'
      )
        armHits += n;
      else bodyHits += n;
    }
    ex.commitVolumes();
    // 壊しているあいだは重くなる
    ex.resist += (Math.min(5, bodyHits / 5) - ex.resist) * (1 - Math.exp(-6 * dt));
    if (bodyHits + armHits > 6) rig.addShake(Math.min(0.5, (bodyHits + armHits) * 0.005));
    loadAvg += (Math.min(1, (bodyHits + armHits) / 25) - loadAvg) * (1 - Math.exp(-5 * dt));

    // 4) 履帯の跡・足元の土煙
    const moved = Math.hypot(ex.x - lastTread.x, ex.z - lastTread.z);
    if (moved > 1.3) {
      city.decals.tread(
        ex.x,
        ex.z,
        ex.heading,
        4.95 * MACHINE_SCALE,
        3.0 * MACHINE_SCALE,
        1.9 * MACHINE_SCALE
      );
      lastTread = { x: ex.x, z: ex.z };
    }
    dustTimer -= dt;
    const sp = Math.abs(ex.speed);
    if (sp > 1.2 && dustTimer <= 0) {
      dustTimer = 0.09;
      const f = ex.forwardDir;
      for (const s of [-1, 1]) {
        city.dust.emit({
          count: 1,
          x: ex.x - f.x * 7 * MACHINE_SCALE - f.y * s * 4.95 * MACHINE_SCALE,
          y: 0.5,
          z: ex.z - f.y * 7 * MACHINE_SCALE + f.x * s * 4.95 * MACHINE_SCALE,
          spread: 2,
          speed: 2,
          size: 3,
          life: 2.4,
          tone: 0.7,
          alpha: 0.16 + Math.min(0.12, sp * 0.02),
        });
      }
    }
    armMotion = Math.min(
      1,
      Math.abs(ex.joints.boom.target - ex.joints.boom.angle) * 3 +
        Math.abs(ex.joints.stick.target - ex.joints.stick.angle) * 3 +
        Math.abs(ex.joints.swing.target - ex.joints.swing.angle) * 2
    );
    sfx.update(loadAvg, Math.min(1, sp / 8.6), armMotion);

    // 5) 街・光・カメラ
    env.sunTint(sunColor);
    ambient.copy(env.hemi.color).multiplyScalar(env.hemi.intensity * 1.6 + 0.12);
    const fovScale =
      renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    // 描画バッファの高さではなく CSS ピクセル換算（Points の大きさは drawing buffer 基準）
    city.update(dt, sunColor, ambient, env.fog.color, env.fog.density, fovScale);

    focus.set(ex.x, 7 * MACHINE_SCALE, ex.z);
    rig.update(dt, focus);
    env.followShadow(tmp.set(ex.x, 0, ex.z));

    // 照準の表示（30Hz）
    reticleTimer -= dt;
    if (reticleTimer <= 0) {
      reticleTimer = 1 / 30;
      if (hasPointer) {
        const p = pick(ndc.x, ndc.y);
        if (p) {
          tmp2.copy(p).project(camera);
          if (tmp2.z < 1) {
            reticle.hidden = false;
            reticle.style.transform = `translate(${((tmp2.x + 1) / 2) * innerWidth}px, ${((1 - tmp2.y) / 2) * innerHeight}px)`;
          } else reticle.hidden = true;
        } else reticle.hidden = true;
      }
    }

    // 6) 描画
    if (draw) {
      if (post.isEnabled) post.render(dt, time);
      else renderer.render(scene, camera);
    }

    // 7) HUD と動的解像度
    frames++;
    fpsTime += dt;
    hudTimer += dt;
    if (fpsTime >= 0.5) {
      fps = frames / fpsTime;
      frames = 0;
      fpsTime = 0;
      hud.fps.textContent = String(Math.round(fps));
      // 動的解像度: 遅いときは解像度を落とし、余裕があれば戻す
      if (fps < 38) {
        slowMs += 0.5;
        fastMs = 0;
      } else if (fps > 58) {
        fastMs += 0.5;
        slowMs = 0;
      } else {
        slowMs = fastMs = 0;
      }
      if (slowMs >= 1.5 && pixelRatio > 0.55) {
        pixelRatio = Math.max(0.55, pixelRatio - 0.15);
        slowMs = 0;
        resize();
      } else if (fastMs >= 4 && pixelRatio < maxDpr()) {
        pixelRatio = Math.min(maxDpr(), pixelRatio + 0.1);
        fastMs = 0;
        resize();
      }
    }
    if (hudTimer >= 0.25) {
      hudTimer = 0;
      const pct = (city.stats.destroyedCells / city.stats.totalCells) * 100;
      hud.pct.textContent = pct < 10 ? pct.toFixed(1) : String(Math.round(pct));
      hud.bar.style.width = `${Math.min(100, pct)}%`;
      hud.down.textContent = String(city.stats.buildingsDown);
    }
  }

  applyTime();
  applySound();
  applyQuality();
  // 最初のフレームで影・ガラスの反射が整うよう、数フレーム空回しする
  let last = performance.now();
  let warm = 3;
  const loop = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    frame(dt);
    if (warm-- === 0) $('loading').classList.add('done');
    requestAnimationFrame(loop);
  };
  // ?manual: 自動のループを止め、__rampage.frame(dt) で 1 フレームずつ進める（検証用）
  if (params.has('manual')) $('loading').classList.add('done');
  else requestAnimationFrame(loop);

  // 検証用の窓口（?debug を付けたときだけ公開）
  if (params.has('debug')) {
    (window as unknown as { __rampage: unknown }).__rampage = {
      ex,
      city,
      rig,
      env,
      auto,
      camera,
      setTime: (i: number) => {
        timeIdx = i;
        applyTime();
      },
      smashAt,
      frame,
    };
  }
}

// 画面が描けるようになってから街を作る（読み込み表示を先に出す）
requestAnimationFrame(() => setTimeout(boot, 30));
