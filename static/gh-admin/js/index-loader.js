import { t } from './i18n.js';

// 索引（gh-admin/index.json など）を 1 ファイルずつ読む。next をたどり、slug で重複を除く。
// onPage(読んだ分, 全件数) は 1 ファイルごとに呼ぶ。stop(読んだ分) が true を返したら、そこで読むのを止める。
export async function loadIndex(url, { onPage, stop } = {}) {
  const seen = new Set();
  const items = [];
  let next = url;
  while (next) {
    const res = await fetch(next, { cache: 'no-store' });
    if (!res.ok) throw new Error(t('error.index_load', { status: res.status }));
    const page = await res.json();
    for (const item of page.items) {
      if (seen.has(item.slug)) continue;
      seen.add(item.slug);
      items.push(item);
    }
    onPage?.(items, page.total);
    if (stop?.(items)) break;
    next = page.next;
  }
  return items;
}

// 索引を必要な分だけ読む。最初は何も読まず、ensure(n) で n 件まで、loadAll() で最後まで読む。
// 同時に呼ばれても同じファイルを二重に読まない
export function createIndexReader(url) {
  const seen = new Set();
  const reader = { items: [], total: null, first: null, done: false };
  let next = url;
  let pending = null;
  async function loadNext() {
    if (pending) return pending;
    if (!next) {
      reader.done = true;
      return;
    }
    pending = (async () => {
      const res = await fetch(next, { cache: 'no-store' });
      if (!res.ok) throw new Error(t('error.index_load', { status: res.status }));
      const page = await res.json();
      reader.first ??= page;
      for (const item of page.items) {
        if (seen.has(item.slug)) continue;
        seen.add(item.slug);
        reader.items.push(item);
      }
      reader.total = page.total;
      next = page.next;
      reader.done = !next;
    })();
    try {
      await pending;
    } finally {
      pending = null;
    }
  }
  reader.ensure = async (count) => {
    while (!reader.done && reader.items.length < count) await loadNext();
  };
  reader.loadAll = async () => {
    while (!reader.done) await loadNext();
  };
  return reader;
}
