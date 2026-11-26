// 浮かせる管理ボタン。管理画面の部品を組み込んでいないテーマ（外部テーマ）のページに、ビルド後に差し込んで読む。
// 画面の左下にボタンを出す。ログインしていなければログイン画面への入口だけ、ログインしていれば管理画面へのメニュー。
// 設定は gh-admin/config/index.json、固定ページの一覧（「このページを編集」の判定）はログイン中だけ gh-admin/index.json から読む。
// テーマの CSS と混ざらないように Shadow DOM の中に描画する。設定の meta が無いページでも動くように、config.js を読むモジュールは使わない。

// このファイルは <サイトのルート>/gh-admin/js/float.js に置かれる
import { hasStoredToken, clearStoredSession } from './session.js';
import { slugFromPostPath } from './post-url.js';

const ROOT = new URL('../../', import.meta.url);
const CONFIG_URL = new URL('gh-admin/config/index.json', ROOT);
const INDEX_URL = new URL('gh-admin/index.json', ROOT);

function logout() {
  clearStoredSession();
  location.reload();
}

async function fetchJson(url, cache = 'no-store') {
  const res = await fetch(url, { cache });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

const samePath = (url) => {
  try {
    return decodeURI(new URL(url, location.href).pathname) === decodeURI(location.pathname);
  } catch {
    return false;
  }
};

// 開いているページが記事か固定ページなら { kind, slug }。first は索引の 1 つ目のファイル（固定ページの一覧を持つ）。
// 記事は、URL を設定 postURL の形に照らして slug を取り出す（索引のすべてのファイルを読まないように）。
// テーマが記事の URL を変えていて形が合わないときは、1 つ目のファイルの記事だけを URL で探す
function findCurrent(first, config) {
  const page = (first.pages ?? []).find((item) => samePath(item.url));
  if (page) return { kind: 'page', slug: page.slug };
  const slug = slugFromPostPath(decodeURI(location.pathname), config.rootURL ?? '/', config.postURL ?? '');
  if (slug) return { kind: 'post', slug };
  const item = first.items.find((entry) => !entry.external && samePath(entry.url));
  return item ? { kind: 'post', slug: item.slug } : null;
}

const ICONS = {
  menu: 'M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z',
  edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75z',
  add: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z',
  login: 'M11 7 9.6 8.4l2.6 2.6H2v2h10.2l-2.6 2.6L11 17l5-5zm9 12h-8v2h8a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-8v2h8z',
  admin: 'M19.14 12.94a7.1 7.1 0 0 0 0-1.88l2.03-1.58-1.92-3.32-2.39.96a7 7 0 0 0-1.62-.94L14.88 3.6h-3.76l-.36 2.58a7 7 0 0 0-1.62.94l-2.39-.96-1.92 3.32 2.03 1.58a7.1 7.1 0 0 0 0 1.88l-2.03 1.58 1.92 3.32 2.39-.96c.5.38 1.04.7 1.62.94l.36 2.58h3.76l.36-2.58a7 7 0 0 0 1.62-.94l2.39.96 1.92-3.32zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z',
  logout: 'M10 17l1.41-1.41L8.83 13H20v-2H8.83l2.58-2.59L10 7l-5 5zM4 5h7V3H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7v-2H4z',
};

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICONS[name]);
  svg.append(path);
  return svg;
}

const STYLE = `
:host { all: initial; }
.wrap {
  position: fixed; left: 16px; bottom: 16px; z-index: 2147483000;
  display: flex; flex-direction: column-reverse; align-items: flex-start; gap: 8px;
  font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
  --bg: #ffffff; --fg: #1f2328; --border: rgba(31, 35, 40, 0.15); --hover: rgba(31, 35, 40, 0.08);
}
@media (prefers-color-scheme: dark) {
  .wrap { --bg: #24292f; --fg: #f0f3f6; --border: rgba(240, 243, 246, 0.2); --hover: rgba(240, 243, 246, 0.1); }
}
button, a {
  display: inline-flex; align-items: center; gap: 8px; box-sizing: border-box;
  color: var(--fg); background: var(--bg); border: 1px solid var(--border);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18); cursor: pointer; text-decoration: none; font: inherit;
}
button:hover, a:hover { background: linear-gradient(var(--hover), var(--hover)), var(--bg); }
button:focus-visible, a:focus-visible { outline: 2px solid #0969da; outline-offset: 2px; }
.toggle { width: 44px; height: 44px; justify-content: center; border-radius: 50%; padding: 0; }
/* ログインしていないときの入口。閲覧の邪魔にならないように小さく薄くする */
.guest { width: 36px; height: 36px; justify-content: center; border-radius: 50%; padding: 0; opacity: 0.75; }
.guest:hover, .guest:focus-visible { opacity: 1; }
.menu { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0; list-style: none; }
.menu[hidden] { display: none; }
.menu a, .menu button { height: 36px; padding: 0 14px; border-radius: 18px; white-space: nowrap; }
svg { width: 18px; height: 18px; fill: currentColor; flex: none; }
`;

function mount(build) {
  const host = document.createElement('div');
  host.id = 'gh-admin-float';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = STYLE;
  const wrap = document.createElement('div');
  wrap.className = 'wrap';
  build(wrap);
  shadow.append(style, wrap);
  document.body.append(host);
}

// ログインしていないとき。ログインしたら今のページに戻る
function renderGuest(config) {
  const label = config.messages?.common?.login ?? 'Login';
  mount((wrap) => {
    const a = document.createElement('a');
    a.className = 'guest';
    a.href = `${config.loginURL}?return=${encodeURIComponent(location.pathname + location.search)}`;
    a.setAttribute('aria-label', label);
    a.title = label;
    a.append(icon('login'));
    wrap.append(a);
  });
}

function render(config, current) {
  const common = config.messages?.common ?? {};
  mount((wrap) => {
    const menu = document.createElement('ul');
    menu.className = 'menu';
    menu.id = 'menu';
    menu.hidden = true;
    const add = (node) => {
      const li = document.createElement('li');
      li.append(node);
      menu.append(li);
    };
    const link = (href, name, label) => {
      const a = document.createElement('a');
      a.href = href;
      a.append(icon(name), document.createTextNode(label));
      return a;
    };

    if (current) {
      const param = current.kind === 'page' ? 'page' : 'slug';
      const label = current.kind === 'page' ? common.edit_page : common.edit_post;
      add(link(`${config.editURL}?${param}=${encodeURIComponent(current.slug)}`, 'edit', label));
    }
    add(link(config.editURL, 'add', common.new_post));
    add(link(config.adminURL, 'admin', common.bulk_admin));
    const out = document.createElement('button');
    out.type = 'button';
    out.append(icon('logout'), document.createTextNode(common.logout));
    out.addEventListener('click', logout);
    add(out);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'toggle';
    toggle.setAttribute('aria-label', common.admin);
    toggle.title = common.admin;
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', 'menu');
    toggle.append(icon('menu'));
    const setOpen = (open) => {
      menu.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
    };
    toggle.addEventListener('click', () => setOpen(menu.hidden));
    wrap.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        toggle.focus();
      }
    });

    wrap.append(toggle, menu);
  });
}

async function start() {
  // 管理画面の部品を組み込んだテーマ（Blogit のテーマなど）は、自前のボタンを持つので出さない
  if (document.querySelector('meta[name="gh-admin"]')) return;
  let config;
  try {
    // 閲覧者全員が読むので、ブラウザのキャッシュを使う
    config = await fetchJson(CONFIG_URL, 'default');
  } catch {
    return;
  }
  // params.ghAdmin.float = false なら出さない。floatGuest = false ならログインしていないときは出さない
  if (config.float === false || !config.editURL) return;
  if (!hasStoredToken()) {
    if (config.floatGuest !== false) renderGuest(config);
    return;
  }
  let current = null;
  try {
    current = findCurrent(await fetchJson(INDEX_URL), config);
  } catch {
    // 一覧が読めなくても、編集以外のボタンは出す
  }
  render(config, current);
}

start();
