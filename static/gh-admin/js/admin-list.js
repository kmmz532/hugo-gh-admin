// /admin/ の一覧・絞り込み・選択・一括操作。
// 一覧は索引（gh-admin/index.json。1 ファイル 50 件）から作る。最初は 1 ファイルだけ読み、次のページを開いたときに次のファイルを読む。
// 絞り込み・タグやカテゴリの候補は全件が必要なので、そのときだけ残りを読む。ユーザー由来の文字列は textContent で描画する。
import { config } from './config.js';
import { ensureDevSession, getToken, getPost, commitChanges, ConflictError } from './backend.js';
import { applyBulk } from './frontmatter.js';
import { createIndexReader } from './index-loader.js';
import { renderPager } from './pager.js';
import { t } from './i18n.js';

const $ = (id) => document.getElementById(id);
const ACTION_LABELS = {
  delete: t('admin.action_delete'),
  category: t('admin.action_category'),
  addTags: t('admin.action_add_tags'),
  removeTags: t('admin.action_remove_tags'),
  replaceTags: t('admin.action_replace_tags'),
};

let articles = [];
// 1 ページの件数。索引の 1 ファイルと同じにして、ページを開くときに読むファイルを 1 つにする
let pageSize = 50;
let currentPage = 1;
let reader = null;
// 固定ページ。一括操作の対象にはしない
let pages = [];
// 選んでいる記事の slug。絞り込みで隠れても選択は残す
const selected = new Set();

const splitTags = (text) =>
  text
    .split(',')
    .map((tag) => tag.trim().replace(/^#/, ''))
    .filter(Boolean);

// 表記ゆれを比べるための形。全角半角・大文字小文字・空白と一部の記号の違いを無視する
const tagKey = (tag) => tag.normalize('NFKC').toLowerCase().replace(/[\s._\-・/]/g, '');

// 記事のタグを件数の多い順に数え、表記ゆれの候補（tagKey が同じもの）をまとめる
function tagStats() {
  const counts = new Map();
  for (const item of articles) {
    for (const tag of item.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  const tags = [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const groups = new Map();
  for (const tag of tags) {
    const key = tagKey(tag.name);
    groups.set(key, [...(groups.get(key) ?? []), tag]);
  }
  return { tags, variants: [...groups.values()].filter((group) => group.length > 1) };
}

// タグの絞り込みの選択肢。表記ゆれの候補は先頭のグループにまとめる。値はタグ名の配列（JSON）
function fillTagOptions() {
  const box = $('admin-tag');
  const current = box.value;
  const { tags, variants } = tagStats();
  const option = (value, text) => {
    const element = document.createElement('option');
    element.value = value;
    element.textContent = text;
    return element;
  };
  const label = ({ name, count }) => `#${name} (${count})`;
  const children = [option('', t('admin.tag_all'))];
  if (variants.length) {
    const group = document.createElement('optgroup');
    group.label = t('admin.tag_variants', { count: variants.length });
    for (const variant of variants) {
      group.append(option(JSON.stringify(variant.map(({ name }) => name)), variant.map(label).join(' / ')));
    }
    children.push(group);
  }
  const all = document.createElement('optgroup');
  all.label = t('admin.tag_list');
  all.append(...tags.map((tag) => option(JSON.stringify([tag.name]), label(tag))));
  children.push(all);
  box.replaceChildren(...children);
  box.value = [...box.options].some((item) => item.value === current) ? current : '';
}

// 絞り込み中のタグ（表記ゆれの候補を選んだときは複数）
const filterTags = () => ($('admin-tag').value ? JSON.parse($('admin-tag').value) : []);

const matches = (item) => {
  const needle = $('admin-search').value.trim().toLowerCase();
  return !needle || (item.title || item.slug).toLowerCase().includes(needle);
};

function visibleArticles() {
  const needle = $('admin-search').value.trim().toLowerCase();
  const kind = $('admin-kind').value;
  if (kind === 'page') return [];
  const tags = filterTags();
  return articles.filter((item) => {
    if (tags.length && !(item.tags ?? []).some((tag) => tags.includes(tag))) return false;
    if (kind === 'article' && item.external) return false;
    if (kind === 'external' && !item.external) return false;
    return !needle || item.title.toLowerCase().includes(needle);
  });
}

function cell(text) {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
}

function row(item) {
  const tr = document.createElement('tr');

  const check = document.createElement('input');
  check.type = 'checkbox';
  check.disabled = !ready;
  check.checked = selected.has(item.slug);
  check.setAttribute('aria-label', t('admin.select_label', { title: item.title || item.slug }));
  check.addEventListener('change', () => {
    if (check.checked) selected.add(item.slug);
    else selected.delete(item.slug);
    updateBar();
  });
  const checkCell = document.createElement('td');
  checkCell.append(check);

  const title = document.createElement('a');
  title.href = `${config.editURL}?slug=${encodeURIComponent(item.slug)}`;
  title.textContent = item.title || item.url || t('common.untitled');
  const titleCell = document.createElement('td');
  titleCell.append(title);
  const actionCell = document.createElement('td');
  if (!item.external) {
    const copy = document.createElement('a');
    copy.href = `${config.editURL}?from=${encodeURIComponent(item.slug)}`;
    copy.className = 'btn template-action';
    copy.textContent = t('admin.make_template');
    actionCell.append(copy);
  }

  tr.append(
    checkCell,
    cell(item.date.replaceAll('-', '.')),
    titleCell,
    cell(item.external ? t('admin.kind_external') : t('admin.kind_article')),
    cell((item.categories ?? []).join(' / ')),
    cell((item.tags ?? []).map((tag) => `#${tag}`).join(' ')),
    actionCell,
  );
  return tr;
}

// 固定ページの行。選択欄は出さない
function pageRow(item) {
  const tr = document.createElement('tr');
  const title = document.createElement('a');
  title.href = `${config.editURL}?page=${encodeURIComponent(item.slug)}`;
  title.textContent = item.title || item.slug;
  const titleCell = document.createElement('td');
  titleCell.append(title);
  const notes = [item.menu ? t('admin.page_in_menu') : '', item.noindex ? t('admin.noindex') : ''].filter(Boolean).join(' / ');
  tr.append(cell(''), cell(''), titleCell, cell(t('admin.kind_page')), cell(notes), cell(''), cell(''));
  return tr;
}

function visiblePages() {
  const kind = $('admin-kind').value;
  if (filterTags().length) return [];
  return kind === 'all' || kind === 'page' ? pages.filter(matches) : [];
}

// 絞り込みを使っているか。使っているときは全件を読んでから絞り込む
const filtering = () => Boolean($('admin-search').value.trim()) || $('admin-kind').value !== 'all' || filterTags().length > 0;

// 残りの索引を読む。読み終えたら候補を作り直す
async function loadAll() {
  if (!reader || reader.done) return;
  setStatus(t('admin.reading_all'));
  try {
    await reader.loadAll();
    articles = byNewest([...reader.items]);
    fillCategoryOptions();
    fillTagOptions();
    setStatus('');
  } catch {
    setStatus(t('error.list_load'));
  }
}

// 今のページに出す記事。絞り込みが無ければ、そのページの分だけ索引を読む
async function pageItems() {
  if (filtering()) {
    await loadAll();
    const visible = visibleArticles();
    return { items: visible.slice((currentPage - 1) * pageSize, currentPage * pageSize), count: visible.length };
  }
  if (reader) {
    await reader.ensure(currentPage * pageSize);
    articles = byNewest([...reader.items]);
  }
  const total = reader?.total ?? articles.length;
  return { items: visibleArticles().slice((currentPage - 1) * pageSize, currentPage * pageSize), count: total };
}

let renderId = 0;
async function renderRows() {
  const id = ++renderId;
  const { items: visible, count } = await pageItems();
  // 読み込み中に次の描画が始まっていたら、古い結果は捨てる
  if (id !== renderId) return;
  const lastPage = Math.max(1, Math.ceil(count / pageSize));
  if (currentPage > lastPage) {
    currentPage = lastPage;
    renderRows();
    return;
  }
  // 固定ページは 1 ページ目にだけ出す
  const visiblePageItems = currentPage === 1 ? visiblePages() : [];
  shownArticles = visible;
  $('admin-rows').replaceChildren(...visiblePageItems.map(pageRow), ...visible.map(row));
  $('admin-count').textContent = t('admin.count', { visible: count + visiblePages().length, total: (reader?.total ?? articles.length) + pages.length });
  $('admin-all').checked = visible.length > 0 && visible.every((item) => selected.has(item.slug));
  renderPager($('admin-pager'), {
    page: currentPage,
    pages: lastPage,
    onChange: (page) => {
      currentPage = page;
      renderRows();
      $('admin-rows').closest('table')?.scrollIntoView({ block: 'start' });
    },
  });
  updateBar();
}

// 絞り込みを変えたら 1 ページ目に戻る
function refilter() {
  currentPage = 1;
  renderRows();
}

// 表示中のページの記事（すべて選ぶの対象）
let shownArticles = [];

// 選んだ記事の数と、選んだ操作の入力欄
function updateBar() {
  const action = $('bulk-action').value;
  $('bulk-category').hidden = action !== 'category';
  $('bulk-tags').hidden = !['addTags', 'removeTags', 'replaceTags'].includes(action);
  $('bulk-tags-to').hidden = action !== 'replaceTags';
  $('bulk-count').textContent = t('admin.selected', { count: selected.size });
  $('bulk-apply').disabled = selected.size === 0;
  $('bulk-bar').hidden = selected.size === 0;
}

// 設定できるカテゴリの階層を、すべての記事から集める（段の重複は除く）
function categoryPaths() {
  const seen = new Map();
  for (const item of articles) {
    for (let k = 1; k <= (item.categories ?? []).length; k++) {
      const path = item.categories.slice(0, k);
      seen.set(JSON.stringify(path), path);
    }
  }
  return [...seen.values()].sort((a, b) => a.join('/').localeCompare(b.join('/')));
}

function fillCategoryOptions() {
  $('bulk-category').replaceChildren(
    ...categoryPaths().map((path) => {
      const option = document.createElement('option');
      option.value = JSON.stringify(path);
      option.textContent = path.join(' / ');
      return option;
    }),
  );
}

// 選んだ操作の中身。入力に問題があれば文字列でエラーを返す
function bulkOptions(action) {
  if (action === 'category') {
    const value = $('bulk-category').value;
    if (!value) return t('admin.category_required');
    return { categories: JSON.parse(value) };
  }
  if (action === 'addTags' || action === 'removeTags' || action === 'replaceTags') {
    const tags = splitTags($('bulk-tags').value);
    if (!tags.length) return t('admin.tags_required');
    if (action === 'replaceTags') {
      const [to] = splitTags($('bulk-tags-to').value);
      if (!to) return t('admin.tags_to_required');
      return { replaceTags: { from: tags, to } };
    }
    return action === 'addTags' ? { addTags: tags } : { removeTags: tags };
  }
  return {};
}

const setStatus = (text) => {
  $('admin-status').textContent = text;
};

// 一括操作を実行する。確認 → 記事を読む → 変換 → 1 コミット。途中で失敗したら何も変えない
async function apply() {
  if (!ready) return;
  const action = $('bulk-action').value;
  const slugs = [...selected];
  if (!slugs.length) return;
  const options = bulkOptions(action);
  if (typeof options === 'string') {
    setStatus(options);
    return;
  }

  const count = slugs.length;
  if (action === 'delete') {
    const typed = prompt(t('admin.delete_prompt', { count }));
    if (typed !== String(count)) {
      setStatus(t('admin.delete_cancelled'));
      return;
    }
  } else if (!confirm(t('admin.apply_confirm', { count, action: ACTION_LABELS[action] }))) {
    setStatus(t('admin.cancelled'));
    return;
  }

  $('bulk-apply').disabled = true;
  setStatus(t('admin.saving'));
  try {
    const changes = {};
    // GitLab は読み込んだときの版（sha）と比べて、他で更新された記事を ConflictError にする
    const bases = {};
    if (action === 'delete') {
      for (const slug of slugs) changes[slug] = null;
    } else {
      const posts = await Promise.all(slugs.map((slug) => getPost(slug)));
      slugs.forEach((slug, index) => {
        if (!posts[index]) throw new Error(t('admin.post_missing', { slug }));
        changes[slug] = applyBulk(posts[index].text, options);
        bases[slug] = posts[index].sha;
      });
    }
    await commitChanges(changes, t('admin.commit_message', { action: ACTION_LABELS[action], count }), bases);

    // 一覧も変更後の内容に合わせる（index.json は次の反映で更新される）
    if (action === 'delete') {
      articles = articles.filter((item) => !slugs.includes(item.slug));
      if (reader) {
        reader.items = reader.items.filter((item) => !slugs.includes(item.slug));
        reader.total -= slugs.length;
      }
    } else {
      for (const item of articles) {
        if (!slugs.includes(item.slug)) continue;
        if (options.categories) item.categories = options.categories;
        if (options.addTags) item.tags = [...new Set([...(item.tags ?? []), ...options.addTags])];
        if (options.removeTags) item.tags = (item.tags ?? []).filter((tag) => !options.removeTags.includes(tag));
        const replace = options.replaceTags;
        if (replace && (item.tags ?? []).some((tag) => replace.from.includes(tag))) {
          item.tags = [...new Set(item.tags.map((tag) => (replace.from.includes(tag) ? replace.to : tag)))];
        }
      }
    }
    selected.clear();
    fillCategoryOptions();
    fillTagOptions();
    renderRows();
    setStatus(t('admin.saved', { count }));
  } catch (error) {
    setStatus(
      error instanceof ConflictError
        ? t('admin.conflict')
        : error.message,
    );
  } finally {
    $('bulk-apply').disabled = selected.size === 0;
  }
}

function attach() {
  $('admin-search').addEventListener('input', refilter);
  $('admin-kind').addEventListener('change', refilter);
  // タグの絞り込みとカテゴリの設定の候補は全件から作る
  $('admin-tag').addEventListener('focus', loadAll);
  $('bulk-category').addEventListener('focus', loadAll);
  $('admin-tag').addEventListener('change', () => {
    // 表記ゆれの候補を選んだら、置き換えの入力欄に候補を入れておく（置き換え後は件数の多いほう）
    const tags = filterTags();
    if (tags.length > 1) {
      $('bulk-action').value = 'replaceTags';
      $('bulk-tags').value = tags.join(', ');
      $('bulk-tags-to').value = tags[0];
    }
    refilter();
  });
  $('admin-all').addEventListener('change', () => {
    for (const item of shownArticles) {
      if ($('admin-all').checked) selected.add(item.slug);
      else selected.delete(item.slug);
    }
    renderRows();
  });
  $('bulk-action').addEventListener('change', updateBar);
  $('bulk-apply').addEventListener('click', apply);
}

// 一覧の選択・一括操作は、最初のページを読み終えてから有効にする
let ready = false;
function setReady(on) {
  ready = on;
  for (const id of ['admin-search', 'admin-kind', 'admin-tag', 'admin-all']) $(id).disabled = !on;
  renderRows();
}

const byNewest = (items) => items.sort((a, b) => b.date.localeCompare(a.date));

async function load() {
  const indexUrl = document.querySelector('script[data-index-url]').dataset.indexUrl;
  reader = createIndexReader(indexUrl);
  try {
    // 最初のファイルだけ読む。固定ページの一覧も最初のファイルにある
    await reader.ensure(1);
    pageSize = Math.max(1, reader.first?.items?.length || pageSize);
    pages = (reader.first?.pages ?? []).sort((a, b) => (a.title || a.slug).localeCompare(b.title || b.slug));
    articles = byNewest([...reader.items]);
    fillCategoryOptions();
    fillTagOptions();
    setReady(true);
  } catch {
    setStatus(t('error.list_load'));
  }
}

await ensureDevSession();
if (getToken()) {
  attach();
  load();
} else {
  location.replace(`${config.loginURL}?return=${encodeURIComponent(location.pathname + location.search)}`);
}
