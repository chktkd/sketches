let seq = 1;
export const nid = (): string => 'L' + Date.now().toString(36) + seq++;

/** _bb（描画キャッシュ）を落としたディープコピー */
export const stripBB = (k: string, v: unknown) => (k === '_bb' ? undefined : v);
export const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o, stripBB));

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & Record<string, unknown> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...children);
  return e;
}

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} not found`);
  return e as T;
}
