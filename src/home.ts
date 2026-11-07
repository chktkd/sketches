import './home.css';
import type { SketchMeta } from './meta';

/* sketches/<slug>/meta.ts を自動で集める。スケッチを足すと一覧に自動で載る */
const modules = import.meta.glob<SketchMeta>('../sketches/*/meta.ts', {
  eager: true,
  import: 'default',
});

const items = Object.entries(modules)
  .map(([path, meta]) => ({ slug: path.split('/').at(-2)!, ...meta }))
  .sort((a, b) => b.date.localeCompare(a.date));

const list = document.getElementById('list')!;
const base = import.meta.env.BASE_URL;

for (const it of items) {
  const li = document.createElement('li');
  const a = document.createElement('a');
  a.href = `${base}sketches/${it.slug}/`;
  a.className = 'item';

  const date = document.createElement('time');
  date.dateTime = it.date;
  date.textContent = it.date.replaceAll('-', '.');

  const title = document.createElement('span');
  title.className = 'title';
  title.textContent = it.title;

  const desc = document.createElement('span');
  desc.className = 'desc';
  desc.textContent = it.description;

  const tags = document.createElement('span');
  tags.className = 'tags';
  tags.textContent = (it.tags ?? []).map((t) => `#${t}`).join(' ');

  a.append(date, title, desc, tags);
  li.append(a);
  list.append(li);
}

if (!items.length) list.innerHTML = '<li class="empty">まだスケッチがありません</li>';
