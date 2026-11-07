import '../../src/base.css';
import './style.css';
import { encodeGIF } from './gif';
import { E, PRESETS, R, T } from './presets';
import { clearCaches, getCtx, newCanvas, render, setImageLoadHandler } from './render';
import { H, W, type Crop, type Doc, type ImageLayer, type Layer } from './types';
import { byId, clamp, clone, el, nid, stripBB } from './util';

const STORAGE_KEY = 'sketch:88x31-banner:v3';
const FONTS: [string, string][] = [
  ['Silkscreen', 'Silkscreen（英字ドット）'],
  ['Press Start 2P', 'Press Start 2P'],
  ['Pixelify Sans', 'Pixelify Sans'],
  ['VT323', 'VT323'],
  ['DotGothic16', 'DotGothic16（日本語OK）'],
  ['Verdana', 'Verdana'],
  ['Tahoma', 'Tahoma'],
];

/* ---------- elements ---------- */
const big = byId<HTMLCanvasElement>('big');
const cbox = byId('cbox');
const selBox = byId('sel');
const input = (id: string) => byId<HTMLInputElement>(id);
const select_ = (id: string) => byId<HTMLSelectElement>(id);
const button = (id: string) => byId<HTMLButtonElement>(id);
const image = (id: string) => byId<HTMLImageElement>(id);

/* ---------- state ---------- */
let doc: Doc;
let fi = 0;
let selId: string | null = null;
let playing: number | null = null;
let replaceTarget: string | null = null;
interface Drag {
  mode: 'move' | 'resize';
  p: { x: number; y: number };
  x: number;
  y: number;
  w: number;
  h: number;
  size: number;
  lx: number;
  ly: number;
}
let drag: Drag | null = null;

const lay = () => doc.frames[fi].layers;
const cur = (): Layer | null => lay().find((l) => l.id === selId) ?? null;

/* ---------- draw / save / undo ---------- */
let lastURL = '';
let flushT: number | undefined;
let thumbT: number | undefined;
let lastSnap = '';
let undoS: string[] = [];
let redoS: string[] = [];
const snap = () =>
  JSON.stringify({ bg: doc.bg, border: doc.border, frames: doc.frames, link: doc.link }, stripBB);

function draw() {
  if (playing !== null) stopPlay();
  render(doc, fi, big);
  lastURL = big.toDataURL('image/png');
  image('out1').src = lastURL;
  image('out2').src = lastURL;
  const th = document.querySelector<HTMLImageElement>(`#frames button[data-i="${fi}"] img`);
  if (th) th.src = lastURL;
  const L = cur();
  if (L && L.visible && L._bb) {
    const b = L._bb;
    selBox.hidden = false;
    Object.assign(selBox.style, {
      left: `${(b.x / W) * 100}%`,
      top: `${(b.y / H) * 100}%`,
      width: `${(b.w / W) * 100}%`,
      height: `${(b.h / H) * 100}%`,
    });
  } else selBox.hidden = true;
  clearTimeout(flushT);
  flushT = window.setTimeout(flush, 350);
}

function flush() {
  clearTimeout(flushT);
  if (!drag) commit();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(doc, stripBB));
  } catch {
    toast('自動保存の容量が足りません。画像を減らしてください');
  }
}
function commit() {
  const s = snap();
  if (s === lastSnap) return;
  if (lastSnap) {
    undoS.push(lastSnap);
    if (undoS.length > 150) undoS.shift();
  }
  redoS = [];
  lastSnap = s;
  undoBtns();
}
function undoBtns() {
  button('undo').disabled = !undoS.length;
  button('redo').disabled = !redoS.length;
}
function restore(s: string) {
  Object.assign(doc, JSON.parse(s));
  fi = Math.min(fi, doc.frames.length - 1);
  lastSnap = s;
  fullUI();
  draw();
  undoBtns();
}
function undo() {
  flush();
  const s = undoS.pop();
  if (s === undefined) return;
  redoS.push(lastSnap);
  restore(s);
}
function redo() {
  flush();
  const s = redoS.pop();
  if (s === undefined) return;
  undoS.push(lastSnap);
  restore(s);
}
button('undo').onclick = undo;
button('redo').onclick = redo;

/* ---------- linked edits across frames ---------- */
function others(id: string, fn: (o: Layer) => void) {
  if (!doc.link) return;
  doc.frames.forEach((f, i) => {
    if (i === fi) return;
    const o = f.layers.find((l) => l.id === id);
    if (o) fn(o);
  });
}
/** 連動中は同じ id のレイヤーへ設定をコピー。位置は移動量だけ、表示/非表示はフレームごと */
function propagate(L: Layer, dx = 0, dy = 0) {
  others(L.id, (o) => {
    const src = L as unknown as Record<string, unknown>,
      dst = o as unknown as Record<string, unknown>;
    for (const k in src) {
      if (k === 'x' || k === 'y' || k === 'visible' || k === '_bb') continue;
      const v = src[k];
      dst[k] = v !== null && typeof v === 'object' ? clone(v) : v;
    }
    o.x += dx;
    o.y += dy;
  });
}

/* ---------- layers ---------- */
function select(id: string | null) {
  selId = id;
  buildList();
  buildProps();
  draw();
}
const label = (L: Layer) =>
  L.type === 'text'
    ? L.text || '(空)'
    : L.type === 'image'
      ? L.name || '画像'
      : L.type === 'rect'
        ? '四角'
        : '円';
const KIND: Record<Layer['type'], string> = {
  text: 'txt',
  image: 'img',
  rect: 'rect',
  ellipse: 'circ',
};
const inScope = (i: number) => i === fi || doc.link;

function addLayer(L: Layer) {
  lay().push(L);
  if (doc.link)
    doc.frames.forEach((f, i) => {
      if (i !== fi) f.layers.push(clone(L));
    });
  select(L.id);
  scheduleThumbs();
}
function delLayer(id: string) {
  doc.frames.forEach((f, i) => {
    if (inScope(i)) f.layers = f.layers.filter((l) => l.id !== id);
  });
  if (selId === id) selId = null;
  select(selId);
  scheduleThumbs();
}
function moveLayer(id: string, dir: 1 | -1) {
  doc.frames.forEach((f, i) => {
    if (!inScope(i)) return;
    const a = f.layers,
      k = a.findIndex((l) => l.id === id),
      j = k + dir;
    if (k < 0 || j < 0 || j >= a.length) return;
    [a[k], a[j]] = [a[j], a[k]];
  });
  buildList();
  draw();
  scheduleThumbs();
}
function dupLayer(L: Layer) {
  const id = nid();
  doc.frames.forEach((f, i) => {
    if (!inScope(i)) return;
    const k = f.layers.findIndex((l) => l.id === L.id);
    if (k < 0) return;
    const c = clone(f.layers[k]);
    c.id = id;
    c.x += 2;
    c.y += 2;
    f.layers.splice(k + 1, 0, c);
  });
  select(id);
  scheduleThumbs();
}

function buildList() {
  const ul = byId('layers');
  ul.innerHTML = '';
  if (!lay().length) {
    ul.append(
      el('li', {
        className: 'empty',
        textContent: 'このフレームにはレイヤーがありません。下のボタンで追加できます',
      })
    );
    return;
  }
  [...lay()].reverse().forEach((L) => {
    const mk = (txt: string, title: string, fn: () => void, cls = 'ib') => {
      const b = el('button', {
        type: 'button',
        className: cls,
        textContent: txt,
        title,
        onclick: fn,
      });
      b.setAttribute('aria-label', title);
      return b;
    };
    const li = el(
      'li',
      { className: `${L.id === selId ? 'on ' : ''}${L.visible ? '' : 'hid'}` },
      el('span', { className: 'kind', textContent: KIND[L.type] }),
      mk(label(L), `選択: ${label(L)}`, () => select(L.id), 'name'),
      mk(L.visible ? '◉' : '○', L.visible ? 'このフレームで非表示' : 'このフレームで表示', () => {
        L.visible = !L.visible;
        buildList();
        draw();
      }),
      mk('▲', '手前へ', () => moveLayer(L.id, 1)),
      mk('▼', '奥へ', () => moveLayer(L.id, -1)),
      mk('⧉', '複製', () => dupLayer(L)),
      mk('×', '削除', () => delLayer(L.id))
    );
    ul.append(li);
  });
}

/* ---------- properties panel ---------- */
function buildProps() {
  const P = byId('props');
  P.innerHTML = '<legend>Selected</legend>';
  const L = cur();
  if (!L) {
    P.append(
      el('p', {
        className: 'empty',
        textContent: 'キャンバス上のパーツをクリックするか、レイヤー一覧から選んでください。',
      })
    );
    return;
  }
  /* パネルはレイヤーの各プロパティをキー名で読み書きする */
  const rec = L as unknown as Record<string, unknown>;
  const ch = (dx = 0, dy = 0) => {
    propagate(L, dx, dy);
    draw();
  };
  const row = (lab: string, control: HTMLElement, forId?: string) => {
    const l = el('label', { textContent: lab });
    if (forId) l.htmlFor = forId;
    P.append(el('div', { className: 'row' }, l, control));
  };
  const inl = (...els: (Node | string)[]) => el('div', { className: 'inline' }, ...els);
  const numIn = (key: string, min: number, max: number, after?: () => void) => {
    const i = el('input', {
      type: 'number',
      id: `p_${key}`,
      min: String(min),
      max: String(max),
      value: String(rec[key]),
    });
    i.oninput = () => {
      const v = parseInt(i.value, 10);
      if (Number.isNaN(v)) return;
      const old = rec[key] as number;
      rec[key] = v;
      after?.();
      ch(key === 'x' ? v - old : 0, key === 'y' ? v - old : 0);
    };
    return i;
  };
  const rng = (key: string, min: number, max: number, fmt: (v: number) => string = String) => {
    const r = el('input', {
      type: 'range',
      id: `p_${key}`,
      min: String(min),
      max: String(max),
      value: String(rec[key]),
    });
    const s = el('span', { className: 'num', textContent: fmt(rec[key] as number) });
    r.oninput = () => {
      rec[key] = +r.value;
      s.textContent = fmt(+r.value);
      ch();
    };
    return inl(r, s);
  };
  const col = (key: string, aria: string) => {
    const i = el('input', { type: 'color', id: `p_${key}`, value: String(rec[key]) });
    i.setAttribute('aria-label', aria);
    i.oninput = () => {
      rec[key] = i.value;
      ch();
    };
    return i;
  };
  const chk = (key: string, txt: string, after?: () => void) => {
    const i = el('input', { type: 'checkbox', id: `p_${key}`, checked: !!rec[key] });
    i.onchange = () => {
      rec[key] = i.checked;
      after?.();
      ch();
    };
    return el('label', { className: 'check' }, i, txt);
  };
  const sel = (key: string, opts: [string, string][]) => {
    const s = el(
      'select',
      { id: `p_${key}` },
      ...opts.map(([v, t]) => el('option', { value: v, textContent: t }))
    );
    s.value = String(rec[key]);
    s.onchange = () => {
      rec[key] = s.value;
      ch();
    };
    return s;
  };
  const btn = (txt: string, fn: () => void, cls = 'btn ghost sm') =>
    el('button', { type: 'button', className: cls, textContent: txt, onclick: fn });

  if (L.type === 'text') {
    const t = el('input', { type: 'text', id: 'p_text', value: L.text, maxLength: 40 });
    t.oninput = () => {
      L.text = t.value;
      ch();
      buildList();
    };
    row('文字', t, 'p_text');
    row('フォント', sel('font', FONTS), 'p_font');
    row(
      'サイズ',
      rng('size', 4, 28, (v) => `${v}px`),
      'p_size'
    );
    row(
      '横幅',
      rng('sx', 40, 160, (v) => `${v}%`),
      'p_sx'
    );
    row(
      '色',
      inl(
        col('color', '文字色'),
        sel('fx', [
          ['none', '効果なし'],
          ['shadow', '影'],
          ['outline', '縁取り'],
        ]),
        col('fxcol', '影・縁取りの色')
      )
    );
    P.append(chk('crisp', 'アンチエイリアスを切る（ドット感）'));
  } else if (L.type === 'rect' || L.type === 'ellipse') {
    row('大きさ', inl(numIn('w', 1, W * 2), '×', numIn('h', 1, H * 2)), 'p_w');
    row('塗り', inl(chk('fillOn', '塗る'), col('fill', '塗り色')));
    row('線', inl(chk('strokeOn', '1px 線'), col('stroke', '線の色')));
  } else if (L.type === 'image') {
    const fitH = () => {
      if (L.lock) {
        L.h = Math.max(1, Math.round(L.w / L.ar));
        input('p_h').value = String(L.h);
      }
    };
    const fitW = () => {
      if (L.lock) {
        L.w = Math.max(1, Math.round(L.h * L.ar));
        input('p_w').value = String(L.w);
      }
    };
    row('大きさ', inl(numIn('w', 1, W * 3, fitH), '×', numIn('h', 1, H * 3, fitW)), 'p_w');
    P.append(chk('lock', '縦横比を固定', fitH));
    row(
      '切り抜き',
      inl(
        btn('トリミング…', () => openCrop(L)),
        btn('解除', () => {
          const a = doc.assets[L.aid];
          L.crop = null;
          L.ar = a.w / a.h;
          if (L.lock) L.h = Math.max(1, Math.round(L.w / L.ar));
          ch();
          buildProps();
        })
      )
    );
    row(
      'ドット',
      rng('blk', 1, 4, (v) => (v === 1 ? '1px' : `${v}px角`)),
      'p_blk'
    );
    row(
      '色数',
      rng('levels', 1, 8, (v) => (v < 2 ? 'そのまま' : `${v}段階`)),
      'p_levels'
    );
    P.append(
      chk('dither', 'ディザ（網点）で階調を補う'),
      chk('alphaCut', '透過の境目をくっきり'),
      chk('flip', '左右反転')
    );
    row(
      '不透明度',
      rng('opacity', 10, 100, (v) => `${v}%`),
      'p_opacity'
    );
    row(
      '差し替え',
      btn('別の画像を選ぶ', () => {
        replaceTarget = L.id;
        input('file').click();
      })
    );
  }
  row('位置 x / y', inl(numIn('x', -W * 2, W * 2), numIn('y', -H * 2, H * 2)), 'p_x');
  const align = (fn: (b: { w: number; h: number }) => void) => () => {
    const b = L._bb ?? { w: 1, h: 1 },
      ox = L.x,
      oy = L.y;
    fn(b);
    ch(L.x - ox, L.y - oy);
    buildProps();
  };
  row(
    '揃える',
    inl(
      btn(
        '左右中央',
        align((b) => {
          L.x = Math.round((W - b.w) / 2);
        })
      ),
      btn(
        '上下中央',
        align((b) => {
          L.y = Math.round((H - b.h) / 2);
        })
      )
    )
  );
  P.append(
    inl(
      btn('複製', () => dupLayer(L)),
      btn(
        doc.link && doc.frames.length > 1 ? '削除（全フレーム）' : '削除',
        () => delLayer(L.id),
        'btn danger sm'
      )
    )
  );
}

/* ---------- pointer editing ---------- */
const pt = (e: PointerEvent, target: HTMLElement) => {
  const r = target.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
};
function hit(p: { x: number; y: number }): Layer | null {
  const a = lay();
  for (let i = a.length - 1; i >= 0; i--) {
    const L = a[i],
      b = L._bb;
    if (!L.visible || !b) continue;
    if (p.x >= b.x - 0.5 && p.x <= b.x + b.w + 0.5 && p.y >= b.y - 0.5 && p.y <= b.y + b.h + 0.5)
      return L;
  }
  return null;
}
cbox.addEventListener('pointerdown', (e) => {
  if (playing !== null) {
    stopPlay();
    draw();
    return;
  }
  const q = pt(e, cbox),
    p = { x: q.x * W, y: q.y * H };
  let mode: Drag['mode'] = 'move';
  if ((e.target as HTMLElement).id === 'handle' && cur()) mode = 'resize';
  else {
    const L = hit(p);
    if (!L) {
      select(null);
      return;
    }
    if (L.id !== selId) select(L.id);
  }
  const L = cur()!;
  const size = L.type === 'text' ? L.size : 0;
  const w = L.type === 'text' ? 0 : L.w,
    h = L.type === 'text' ? 0 : L.h;
  drag = { mode, p, x: L.x, y: L.y, w, h, size, lx: L.x, ly: L.y };
  cbox.setPointerCapture(e.pointerId);
  e.preventDefault();
});
cbox.addEventListener('pointermove', (e) => {
  const L = cur();
  if (!drag || !L) return;
  const q = pt(e, cbox),
    dx = Math.round(q.x * W - drag.p.x),
    dy = Math.round(q.y * H - drag.p.y);
  if (drag.mode === 'move') {
    L.x = drag.x + dx;
    L.y = drag.y + dy;
    propagate(L, L.x - drag.lx, L.y - drag.ly);
    drag.lx = L.x;
    drag.ly = L.y;
  } else {
    if (L.type === 'text') L.size = clamp(drag.size + dy, 4, 40);
    else {
      L.w = Math.max(1, drag.w + dx);
      L.h =
        L.type === 'image' && L.lock
          ? Math.max(1, Math.round(L.w / L.ar))
          : Math.max(1, drag.h + dy);
    }
    propagate(L);
  }
  draw();
});
const endDrag = () => {
  if (drag) {
    drag = null;
    buildProps();
    flush();
    scheduleThumbs();
  }
};
cbox.addEventListener('pointerup', endDrag);
cbox.addEventListener('pointercancel', endDrag);

document.addEventListener('keydown', (e) => {
  if (!byId('cropM').hidden) {
    if (e.key === 'Escape') closeCrop();
    return;
  }
  const t = e.target as HTMLInputElement;
  const typing =
    /INPUT|SELECT|TEXTAREA/.test(t.tagName) && t.type !== 'checkbox' && t.type !== 'range';
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !typing && e.key.toLowerCase() === 'z') {
    e.shiftKey ? redo() : undo();
    e.preventDefault();
    return;
  }
  if (mod && !typing && e.key === 'y') {
    redo();
    e.preventDefault();
    return;
  }
  if (typing) return;
  const L = cur();
  if (!L) return;
  const s = e.shiftKey ? 5 : 1;
  const m = (
    { ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, -s], ArrowDown: [0, s] } as Record<
      string,
      [number, number]
    >
  )[e.key];
  if (m) {
    L.x += m[0];
    L.y += m[1];
    propagate(L, m[0], m[1]);
    draw();
    buildProps();
    e.preventDefault();
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    delLayer(L.id);
    e.preventDefault();
  }
});

/* ---------- adding & import ---------- */
const newText = () =>
  addLayer(
    T({ x: 30, y: 11, text: 'TEXT', color: doc.bg.type === 'none' ? '#000000' : '#ffffff' })
  );
const newRect = () => addLayer(R({ x: 34, y: 6, w: 20, h: 19, fill: '#ffffff' }));
const newEll = () =>
  addLayer(E({ x: 34, y: 5, w: 21, h: 21, fill: '#ffd400', strokeOn: true, stroke: '#000000' }));
const newImg = () => {
  replaceTarget = null;
  input('file').click();
};
for (const s of ['', '2']) {
  button(`addText${s}`).onclick = newText;
  button(`addRect${s}`).onclick = newRect;
  button(`addEll${s}`).onclick = newEll;
  button(`addImg${s}`).onclick = newImg;
}
button('clearL').onclick = () => {
  doc.frames.forEach((f, i) => {
    if (inScope(i)) f.layers = [];
  });
  select(null);
  scheduleThumbs();
  toast('レイヤーを消しました。戻すで復元できます');
};
input('file').onchange = () => {
  const f = input('file').files?.[0];
  input('file').value = '';
  if (f) importFile(f);
};

function importFile(f: File | null | undefined) {
  if (!f || !f.type.startsWith('image/')) {
    toast('画像ファイルを選んでください');
    return;
  }
  const r = new FileReader();
  r.onload = () => {
    const im = new Image();
    im.onload = () => {
      /* 自動保存の容量を抑えるため長辺 384px で保持（トリミングしても 88×31 には十分） */
      const k = Math.min(1, 384 / Math.max(im.width, im.height));
      const c = newCanvas(
        Math.max(1, Math.round(im.width * k)),
        Math.max(1, Math.round(im.height * k))
      );
      const x = getCtx(c);
      x.imageSmoothingQuality = 'high';
      x.drawImage(im, 0, 0, c.width, c.height);
      const aid = 'A' + nid();
      doc.assets[aid] = { src: c.toDataURL('image/png'), w: c.width, h: c.height };
      const ar = c.width / c.height;
      const old = replaceTarget
        ? lay().find((l): l is ImageLayer => l.id === replaceTarget && l.type === 'image')
        : undefined;
      replaceTarget = null;
      if (old) {
        Object.assign(old, { aid, name: f.name, crop: null, ar });
        if (old.lock) old.h = Math.max(1, Math.round(old.w / ar));
        propagate(old);
        select(old.id);
        return;
      }
      let h = H - 4,
        w = Math.round(h * ar);
      if (w > W - 4) {
        w = W - 4;
        h = Math.max(1, Math.round(w / ar));
      }
      addLayer({
        type: 'image',
        id: nid(),
        visible: true,
        name: f.name,
        aid,
        ar,
        crop: null,
        x: Math.round((W - w) / 2),
        y: Math.round((H - h) / 2),
        w,
        h,
        lock: true,
        blk: 1,
        levels: 1,
        dither: false,
        alphaCut: true,
        flip: false,
        opacity: 100,
      });
      toast('取り込みました。トリミングや色数で粗さを調整できます');
    };
    im.onerror = () => toast('この画像は読み込めませんでした');
    im.src = r.result as string;
  };
  r.readAsDataURL(f);
}
const well = byId('well');
well.addEventListener('dragover', (e) => {
  e.preventDefault();
  well.classList.add('drop');
});
well.addEventListener('dragleave', () => well.classList.remove('drop'));
well.addEventListener('drop', (e) => {
  e.preventDefault();
  well.classList.remove('drop');
  replaceTarget = null;
  importFile(e.dataTransfer?.files[0]);
});
document.addEventListener('paste', (e) => {
  if (/INPUT|TEXTAREA/.test((e.target as HTMLElement).tagName)) return;
  const it = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
  if (it) {
    replaceTarget = null;
    importFile(it.getAsFile());
    e.preventDefault();
  }
});

/* ---------- crop ---------- */
let crop: Crop = { x: 0, y: 0, w: 1, h: 1 };
let cropL: ImageLayer | null = null;
let cdrag: { c: string; p: { x: number; y: number }; s: Crop } | null = null;
const cimg = byId('cimg');

function openCrop(L: ImageLayer) {
  cropL = L;
  image('cropImg').src = doc.assets[L.aid].src;
  crop = { x: 0, y: 0, w: 1, h: 1, ...(L.crop ?? {}) };
  select_('cratio').value = 'free';
  byId('cropM').hidden = false;
  placeCrop();
  button('cApply').focus();
}
function closeCrop() {
  byId('cropM').hidden = true;
  cropL = null;
}
function placeCrop() {
  Object.assign(byId('cbx').style, {
    left: `${crop.x * 100}%`,
    top: `${crop.y * 100}%`,
    width: `${crop.w * 100}%`,
    height: `${crop.h * 100}%`,
  });
}
/** 選んだ比率を「元画像に対する割合」の縦横比に直す。0 は自由 */
function ratioF(): number {
  if (!cropL) return 0;
  const v = select_('cratio').value;
  if (v === 'free') return 0;
  const a = doc.assets[cropL.aid];
  const r = v === 'place' ? cropL.w / cropL.h : +v;
  return (r * a.h) / a.w;
}
select_('cratio').onchange = () => {
  const rf = ratioF();
  if (!rf) return;
  const cx = crop.x + crop.w / 2,
    cy = crop.y + crop.h / 2;
  let { w, h } = crop;
  if (w / h > rf) w = h * rf;
  else h = w / rf;
  if (w > 1) {
    w = 1;
    h = w / rf;
  }
  if (h > 1) {
    h = 1;
    w = h * rf;
  }
  crop = { w, h, x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h) };
  placeCrop();
};
button('cReset').onclick = () => {
  crop = { x: 0, y: 0, w: 1, h: 1 };
  select_('cratio').value = 'free';
  placeCrop();
};
button('cCancel').onclick = closeCrop;
byId('cropM').addEventListener('pointerdown', (e) => {
  if ((e.target as HTMLElement).id === 'cropM') closeCrop();
});
button('cApply').onclick = () => {
  const L = cropL;
  if (!L) return;
  const a = doc.assets[L.aid];
  L.crop = crop.w > 0.999 && crop.h > 0.999 ? null : { ...crop };
  L.ar = (crop.w * a.w) / (crop.h * a.h);
  if (L.lock) L.h = Math.max(1, Math.round(L.w / L.ar));
  closeCrop();
  propagate(L);
  buildProps();
  draw();
  scheduleThumbs();
};
cimg.addEventListener('pointerdown', (e) => {
  const t = e.target as HTMLElement,
    c = t.dataset.c;
  if (!c && t.id !== 'cbx') return;
  cdrag = { c: c ?? 'move', p: pt(e, cimg), s: { ...crop } };
  cimg.setPointerCapture(e.pointerId);
  e.preventDefault();
});
cimg.addEventListener('pointermove', (e) => {
  if (!cdrag) return;
  const p = pt(e, cimg),
    s = cdrag.s,
    MIN = 0.03;
  if (cdrag.c === 'move') {
    crop.x = clamp(s.x + p.x - cdrag.p.x, 0, 1 - s.w);
    crop.y = clamp(s.y + p.y - cdrag.p.y, 0, 1 - s.h);
  } else {
    const left = cdrag.c.includes('w'),
      top = cdrag.c.includes('n');
    const ax = left ? s.x + s.w : s.x,
      ay = top ? s.y + s.h : s.y;
    const px = clamp(p.x, 0, 1),
      py = clamp(p.y, 0, 1);
    const maxW = left ? ax : 1 - ax,
      maxH = top ? ay : 1 - ay;
    let w = Math.max(MIN, Math.min(maxW, Math.abs(px - ax)));
    let h = Math.max(MIN, Math.min(maxH, Math.abs(py - ay)));
    const rf = ratioF();
    if (rf) {
      w = Math.min(w, maxH * rf);
      h = w / rf;
    }
    crop = { w, h, x: left ? ax - w : ax, y: top ? ay - h : ay };
  }
  placeCrop();
});
const cEnd = () => {
  cdrag = null;
};
cimg.addEventListener('pointerup', cEnd);
cimg.addEventListener('pointercancel', cEnd);

/* ---------- frames ---------- */
function scheduleThumbs() {
  clearTimeout(thumbT);
  thumbT = window.setTimeout(buildFrames, 120);
}
function buildFrames() {
  const box = byId('frames');
  box.innerHTML = '';
  const cv = newCanvas();
  doc.frames.forEach((f, i) => {
    render(doc, i, cv);
    const b = el(
      'button',
      { type: 'button', className: i === fi ? 'on' : '', onclick: () => selFrame(i) },
      el('img', { src: cv.toDataURL(), alt: '' }),
      el('span', { textContent: `#${i + 1} · ${f.delay}ms` })
    );
    b.dataset.i = String(i);
    b.setAttribute('aria-label', `フレーム${i + 1}（${f.delay}ms）`);
    box.append(b);
  });
  render(doc, fi, big); /* 当たり判定を表示中のフレームに戻す */
  input('delay').value = String(doc.frames[fi].delay);
  button('fDel').disabled = doc.frames.length < 2;
  button('fLeft').disabled = fi === 0;
  button('fRight').disabled = fi === doc.frames.length - 1;
  button('play').disabled = doc.frames.length < 2;
}
function selFrame(i: number) {
  fi = i;
  if (!cur()) selId = null;
  fullUI();
  draw();
  document
    .querySelector(`#frames button[data-i="${i}"]`)
    ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
button('fDup').onclick = () => {
  doc.frames.splice(fi + 1, 0, clone(doc.frames[fi]));
  selFrame(fi + 1);
};
button('fNew').onclick = () => {
  doc.frames.splice(fi + 1, 0, { delay: doc.frames[fi].delay, layers: [] });
  selId = null;
  selFrame(fi + 1);
};
button('fDel').onclick = () => {
  if (doc.frames.length < 2) return;
  doc.frames.splice(fi, 1);
  selFrame(Math.min(fi, doc.frames.length - 1));
};
button('fLeft').onclick = () => {
  if (fi < 1) return;
  [doc.frames[fi - 1], doc.frames[fi]] = [doc.frames[fi], doc.frames[fi - 1]];
  selFrame(fi - 1);
};
button('fRight').onclick = () => {
  if (fi >= doc.frames.length - 1) return;
  [doc.frames[fi + 1], doc.frames[fi]] = [doc.frames[fi], doc.frames[fi + 1]];
  selFrame(fi + 1);
};
input('delay').oninput = () => {
  const v = parseInt(input('delay').value, 10);
  if (!(v >= 20)) return;
  doc.frames[fi].delay = v;
  draw();
  scheduleThumbs();
};
button('delayAll').onclick = () => {
  const v = doc.frames[fi].delay;
  doc.frames.forEach((f) => {
    f.delay = v;
  });
  draw();
  scheduleThumbs();
  toast(`全フレームを ${v}ms にしました`);
};
input('link').onchange = () => {
  doc.link = input('link').checked;
  buildProps();
  draw();
};
button('mkBlink').onclick = () => {
  const L = cur();
  if (!L) {
    toast('先に点滅させるレイヤーを選んでください');
    return;
  }
  const f = clone(doc.frames[fi]);
  const o = f.layers.find((l) => l.id === L.id);
  if (o) o.visible = !L.visible;
  doc.frames.splice(fi + 1, 0, f);
  selFrame(fi);
  toast('次のフレームに、このレイヤーを消したコマを追加しました');
};
button('mkScroll').onclick = () => {
  const L = cur();
  if (!L) {
    toast('先に流すレイヤーを選んでください');
    return;
  }
  const dir = select_('scDir').value,
    st = +select_('scStep').value,
    b = L._bb ?? { w: 10, h: 10 },
    tpl = doc.frames[fi];
  const horiz = dir === 'left' || dir === 'right';
  const from = dir === 'left' ? W : dir === 'right' ? -b.w : dir === 'up' ? H : -b.h;
  const to = dir === 'left' ? -b.w : dir === 'right' ? W : dir === 'up' ? -b.h : H;
  const n = Math.min(240, Math.ceil(Math.abs(to - from) / st));
  const frames = Array.from({ length: n }, (_, k) => {
    const f = clone(tpl);
    f.delay = Math.min(tpl.delay, 80);
    const o = f.layers.find((l) => l.id === L.id);
    const v = from + Math.sign(to - from) * st * k;
    if (o) {
      if (horiz) o.x = v;
      else o.y = v;
    }
    return f;
  });
  doc.frames = frames;
  fi = 0;
  doc.link = true;
  selFrame(0);
  toast(`${n} フレームのスクロールを作りました（戻すで元に戻せます）`);
};
function stopPlay() {
  if (playing !== null) clearTimeout(playing);
  playing = null;
  button('play').textContent = '▶ 再生';
}
button('play').onclick = () => {
  if (playing !== null) {
    stopPlay();
    draw();
    return;
  }
  let k = fi;
  selBox.hidden = true;
  button('play').textContent = '■ 停止';
  const step = () => {
    render(doc, k, big);
    const d = doc.frames[k].delay;
    k = (k + 1) % doc.frames.length;
    playing = window.setTimeout(step, Math.max(20, d));
  };
  step();
};

/* ---------- background / frame ---------- */
function syncBg() {
  select_('bgType').value = doc.bg.type;
  input('bg1').value = doc.bg.c1;
  input('bg2').value = doc.bg.c2;
  select_('border').value = doc.border.type;
  input('bcol').value = doc.border.col;
  input('link').checked = doc.link;
}
const onBg = (fn: () => void) => () => {
  fn();
  draw();
  scheduleThumbs();
};
select_('bgType').oninput = onBg(() => {
  doc.bg.type = select_('bgType').value as Doc['bg']['type'];
});
input('bg1').oninput = onBg(() => {
  doc.bg.c1 = input('bg1').value;
});
input('bg2').oninput = onBg(() => {
  doc.bg.c2 = input('bg2').value;
});
select_('border').oninput = onBg(() => {
  doc.border.type = select_('border').value as Doc['border']['type'];
});
input('bcol').oninput = onBg(() => {
  doc.border.col = input('bcol').value;
});
input('showGrid').onchange = () => {
  byId('grid').hidden = !input('showGrid').checked;
};
function fullUI() {
  syncBg();
  buildFrames();
  buildList();
  buildProps();
}

/* ---------- export ---------- */
function toast(m: string) {
  const t = byId('toast');
  t.textContent = m;
  clearTimeout(Number(t.dataset.t));
  t.dataset.t = String(
    window.setTimeout(() => {
      t.textContent = '';
    }, 3200)
  );
}
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
button('dlPng').onclick = () =>
  big.toBlob((b) => {
    if (b) download(b, 'banner88x31.png');
  }, 'image/png');
button('mkGif').onclick = () => {
  const cv = newCanvas(),
    c = getCtx(cv);
  const frames = doc.frames.map((f, i) => {
    render(doc, i, cv);
    return { data: c.getImageData(0, 0, W, H).data, delay: f.delay };
  });
  render(doc, fi, big);
  const u8 = encodeGIF(frames, W, H);
  const blob = new Blob([u8], { type: 'image/gif' });
  const url = URL.createObjectURL(blob);
  image('gifOut').src = url;
  image('gifOut2').src = url;
  byId('gifFig').hidden = byId('gifFig2').hidden = false;
  byId('gifCap').textContent =
    `GIF 原寸 · ${frames.length}フレーム · ${(u8.length / 1024).toFixed(1)}KB`;
  download(blob, 'banner88x31.gif');
  toast('GIF を書き出しました');
};
async function copy(text: string, lab: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${lab}をコピーしました`);
  } catch {
    toast('コピーできませんでした');
  }
}
button('copyHtml').onclick = () => {
  const alt = lay()
    .filter((l) => l.type === 'text' && l.visible)
    .map((l) => (l as { text: string }).text)
    .join(' ')
    .replace(/"/g, '&quot;');
  const ext = doc.frames.length > 1 ? 'gif' : 'png';
  copy(
    `<a href="https://example.com/"><img src="banner88x31.${ext}" width="88" height="31" alt="${alt}"></a>`,
    'HTML '
  );
};

/* ---------- boot ---------- */
setImageLoadHandler(() => {
  draw();
  scheduleThumbs();
});
function load(d: Doc, keepHistory = false) {
  doc = d;
  clearCaches();
  fi = 0;
  selId = null;
  fullUI();
  draw();
  if (!keepHistory) {
    lastSnap = snap();
    undoBtns();
  }
}
function readSaved(): Doc | null {
  try {
    const o = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Doc | null;
    return o && Array.isArray(o.frames) && o.frames.length ? o : null;
  } catch {
    return null;
  }
}
load(readSaved() ?? PRESETS[0]());
undoBtns();

(async () => {
  try {
    await Promise.all(
      ['Silkscreen', 'Press Start 2P', 'DotGothic16', 'Pixelify Sans', 'VT323'].map((f) =>
        document.fonts.load(`10px "${f}"`, 'Aあ♥')
      )
    );
  } catch {
    /* フォントが取れなくてもフォールバックで描く */
  }
  draw();
  buildFrames();
  const box = byId('presets');
  PRESETS.forEach((mk, i) => {
    const cv = newCanvas();
    render(mk(), 0, cv);
    const b = el(
      'button',
      {
        type: 'button',
        onclick: () => {
          flush();
          load({ ...mk(), assets: doc.assets }, true);
          flush();
        },
      },
      el('img', { src: cv.toDataURL(), alt: '' })
    );
    b.setAttribute('aria-label', `プリセット${i + 1}を読み込む`);
    box.append(b);
  });
})();
