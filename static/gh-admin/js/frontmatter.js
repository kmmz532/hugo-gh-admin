// 記事ファイルの front matter を読み書きする。副作用はない。
import { config } from './config.js';
import { dateToJstInput } from './time.js';
import { t } from './i18n.js';

// 画面で扱うキー。それ以外は raw 行のまま保持して書き戻す。build は読み込みで捨てて保存で作り直す
const KNOWN_KEYS = ['title', 'date', 'lastmod', 'author', 'categories', 'tags', 'summary', 'image', 'aliases', 'external', 'source', 'build', 'sitemap', 'robots', 'menu'];
const LIST_KEYS = ['categories', 'tags', 'aliases'];
// 外部記事はページを作らない。never だとカテゴリ・タグの集計からも外れるので link にする（link もページは作らない）
const EXTERNAL_BUILD = '{"render": "link", "list": "always"}';
const NO_SITEMAP = 'sitemap: {"disable": true}';

// メニュー（固定ページ）。menu: {"main": {"weight": 10}} の 1 行の JSON と menu: main だけを画面で扱う。
// それ以外の書き方（複数行の YAML など）は undefined を返し、元の行のまま残す
function parseMenu(lines) {
  if (lines.length !== 1) return undefined;
  const head = lines[0].slice('menu:'.length).trim();
  if (head === 'main' || head === '"main"') return { weight: null };
  try {
    const value = JSON.parse(head);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const keys = Object.keys(value);
    if (keys.length !== 1 || keys[0] !== 'main') return undefined;
    const main = value.main ?? {};
    if (Object.keys(main).some((key) => key !== 'weight')) return undefined;
    return { weight: Number.isInteger(main.weight) ? main.weight : null };
  } catch {
    return undefined;
  }
}

function unquote(raw) {
  if (raw.startsWith('"')) {
    try {
      return JSON.parse(raw);
    } catch {
      // 下の処理に任せる
    }
  }
  if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1).replace(/''/g, "'");
  return raw;
}

// 解釈できなければ undefined
function parseField(key, lines) {
  const head = lines[0].slice(key.length + 1).trim();
  if (LIST_KEYS.includes(key)) {
    if (head === '') {
      const items = lines.slice(1).map((line) => line.match(/^\s*-\s*(.*)$/)?.[1]);
      if (items.length && items.every((item) => item !== undefined)) {
        return items.map((item) => unquote(item.trim()));
      }
      return undefined;
    }
    try {
      const value = JSON.parse(head);
      return Array.isArray(value) ? value : undefined;
    } catch {
      return undefined;
    }
  }
  return lines.length === 1 ? unquote(head) : undefined;
}

export function parseArticle(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const front = match ? match[1] : '';
  const body = match ? match[2].replace(/^\r?\n/, '') : text;

  const blocks = [];
  for (const line of front.split(/\r?\n/)) {
    const key = line.match(/^([A-Za-z_][\w-]*):/)?.[1];
    if (key) blocks.push({ key, lines: [line] });
    else if (blocks.length) blocks[blocks.length - 1].lines.push(line);
  }

  const values = {};
  const extra = [];
  // メニューが画面で扱えない書き方なら true（メニューの項目を変更できなくする）
  let menuLocked = false;
  let menu = null;
  // sitemap の行。外部記事と「検索エンジンに表示しない」の記事は保存で作り直し、それ以外は元の行のまま残す
  let sitemapLines = [];
  for (const { key, lines } of blocks) {
    if (key === 'menu') {
      const parsed = parseMenu(lines);
      if (parsed === undefined) {
        extra.push(...lines);
        menuLocked = true;
      } else {
        menu = parsed;
      }
      continue;
    }
    // build は外部記事のときに保存で作り直す
    if (key === 'build') continue;
    if (key === 'sitemap') {
      sitemapLines = lines;
      continue;
    }
    if (!KNOWN_KEYS.includes(key)) {
      extra.push(...lines);
      continue;
    }
    // 画面で扱うキーを extra に回すと書き戻し時にキーが重複するので、読み込みを止める
    const value = parseField(key, lines);
    if (value === undefined) {
      throw new Error(t('error.front_matter', { key }));
    }
    values[key] = value;
  }

  const date = String(values.date ?? '');
  const isExternal = values.external !== undefined;
  const robots = String(values.robots ?? '');
  const noindex = robotsDirectives(robots).includes('noindex');
  if (!isExternal && !noindex) extra.push(...sitemapLines);
  return {
    kind: isExternal ? 'external' : 'article',
    fields: {
      slug: '',
      title: String(values.title ?? ''),
      date: dateToJstInput(date),
      // 階層の順のリスト（先頭が一番上）。旧形式の 1 つだけのリストもそのまま読める
      categories: values.categories?.length ? values.categories : [config.defaultCategory],
      tags: values.tags ?? [],
      summary: String(values.summary ?? ''),
      image: String(values.image ?? ''),
      url: String(values.external ?? ''),
      source: String(values.source ?? ''),
      // 更新日。画面では扱わず、更新のたびに保存時の値で上書きする
      lastmod: String(values.lastmod ?? ''),
      author: String(values.author ?? ''),
      // 検索エンジンに表示しない（robots: noindex）。robots は noindex 以外の指定（nofollow など）を残すために持つ
      noindex,
      robots,
      // メニューに表示するか（固定ページ）と並び順
      menu: menu !== null,
      weight: menu?.weight ?? null,
      body,
    },
    aliases: values.aliases ?? [],
    extra,
    menuLocked,
  };
}

// 日時は JST 固定。入力された分単位の値に秒と +09:00 を付ける
function frontFields(fields) {
  return [
    `title: ${JSON.stringify(fields.title)}`,
    `date: ${fields.date}:00+09:00`,
    `categories: ${JSON.stringify(fields.categories)}`,
    `tags: ${JSON.stringify(fields.tags)}`,
    `summary: ${JSON.stringify(fields.summary)}`,
    // 手動のサムネイルは設定したときだけ書く
    ...(fields.image ? [`image: ${JSON.stringify(fields.image)}`] : []),
  ];
}

function robotsDirectives(robots) {
  return robots.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
}

// robots と sitemap の行。robots の noindex 以外の指定（nofollow など）は残す。
// 検索エンジンに表示しないときはサイトマップからも外す（外部記事はもともと載せない。手書きの sitemap が残っていればそれを使う）
function noindexFields(fields, extra, { sitemap = true } = {}) {
  const others = robotsDirectives(fields.robots ?? '').filter((item) => item !== 'noindex' && item !== 'index');
  const directives = fields.noindex ? ['noindex', ...others] : others;
  const lines = [];
  if (directives.length === 1) lines.push(`robots: ${directives[0]}`);
  else if (directives.length) lines.push(`robots: ${JSON.stringify(directives.join(', '))}`);
  const hasSitemap = extra.some((line) => /^sitemap:/.test(line));
  if (fields.noindex && sitemap && !hasSitemap) lines.push(NO_SITEMAP);
  return lines;
}

function withBody(lines, text) {
  const body = text.replace(/^\n+/, '').replace(/\s+$/, '');
  return `---\n${lines.join('\n')}\n---\n\n${body}\n`;
}

function menuField(fields) {
  if (!fields.menu) return [];
  const main = Number.isInteger(fields.weight) ? { weight: fields.weight } : {};
  return [`menu: ${JSON.stringify({ main })}`];
}

export function buildArticle(fields, aliases, extra) {
  const lines = [
    ...frontFields(fields),
    // 作者（GitHub のユーザー名）は設定したときだけ書く
    ...(fields.author ? [`author: ${JSON.stringify(fields.author)}`] : []),
    ...noindexFields(fields, extra),
    ...(fields.lastmod ? [`lastmod: ${fields.lastmod}`] : []),
    ...(aliases.length ? [`aliases: ${JSON.stringify(aliases)}`] : []),
    ...extra,
  ];
  return withBody(lines, fields.body);
}

// 固定ページ（content/<slug>.md）。日時・カテゴリ・タグは持たない。
// menuLocked のときは、元のメニューの行が extra に残っているので書かない
export function buildPage(fields, aliases, extra, { menuLocked = false } = {}) {
  const lines = [
    `title: ${JSON.stringify(fields.title)}`,
    ...(menuLocked ? [] : menuField(fields)),
    ...noindexFields(fields, extra),
    ...(fields.lastmod ? [`lastmod: ${fields.lastmod}`] : []),
    ...(aliases.length ? [`aliases: ${JSON.stringify(aliases)}`] : []),
    ...extra,
  ];
  return withBody(lines, fields.body);
}

// 外部記事は本文を持たず、詳細ページも作らない
export function buildExternal(fields, extra) {
  const lines = [
    ...frontFields(fields),
    `external: ${JSON.stringify(fields.url)}`,
    `source: ${JSON.stringify(fields.source)}`,
    `build: ${EXTERNAL_BUILD}`,
    // ページが無いので、サイトマップにも載せない
    NO_SITEMAP,
    ...noindexFields(fields, extra, { sitemap: false }),
    ...extra,
  ];
  return `---\n${lines.join('\n')}\n---\n`;
}

// 一括操作の変換。カテゴリを置き換え（null なら変えない）、タグを追加・削除する。
// 本文・他の項目・lastmod は変えない。記事と外部記事のどちらも同じ形で扱う
// replaceTags（{ from: [...], to }）は、from のどれかを持つ記事だけ、そのタグを to にする（位置は保つ）
export function applyBulk(text, { categories = null, addTags = [], removeTags = [], replaceTags = null }) {
  const parsed = parseArticle(text);
  let tags = parsed.fields.tags.filter((tag) => !removeTags.includes(tag));
  if (replaceTags && tags.some((tag) => replaceTags.from.includes(tag))) {
    tags = [...new Set(tags.map((tag) => (replaceTags.from.includes(tag) ? replaceTags.to : tag)))];
  }
  for (const tag of addTags) {
    if (!tags.includes(tag)) tags.push(tag);
  }
  const fields = {
    ...parsed.fields,
    categories: categories ?? parsed.fields.categories,
    tags,
  };
  return parsed.kind === 'external'
    ? buildExternal(fields, parsed.extra)
    : buildArticle(fields, parsed.aliases, parsed.extra);
}
