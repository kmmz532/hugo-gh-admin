// /admin/ の一覧・絞り込み・選択・一括操作。
// 一覧は索引（gh-admin/index.json。1 ファイルずつ読む）から作る。ユーザー由来の文字列は textContent で描画する。
import { config } from './config.js';
import { ensureDevSession, getToken, getPost, commitChanges, ConflictError } from './github.js';
import { applyBulk } from './frontmatter.js';
import { loadIndex } from './index-loader.js';
import { t } from './i18n.js';

const $ = (id) => document.getElementById(id);
const ACTION_LABELS = {
  delete: t('admin.action_delete'),
  category: t('admin.action_category'),
  addTags: t('admin.action_add_tags'),
  removeTags: t('admin.action_remove_tags'),
};

let articles = [];
// 選んでいる記事の slug。絞り込みで隠れても選択は残す
const selected = new Set();

const splitTags = (text) =>
  text
    .split(',')
    .map((tag) => tag.trim().replace(/^#/, ''))
    .filter(Boolean);

function visibleArticles() {
  const needle = $('admin-search').value.trim().toLowerCase();
  const kind = $('admin-kind').value;
  return articles.filter((item) => {
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

function renderRows() {
  const visible = visibleArticles();
  $('admin-rows').replaceChildren(...visible.map(row));
  $('admin-count').textContent = t('admin.count', { visible: visible.length, total: articles.length });
  $('admin-all').checked = visible.length > 0 && visible.every((item) => selected.has(item.slug));
  updateBar();
}

// 選んだ記事の数と、選んだ操作の入力欄
function updateBar() {
  const action = $('bulk-action').value;
  $('bulk-category').hidden = action !== 'category';
  $('bulk-tags').hidden = action !== 'addTags' && action !== 'removeTags';
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
  if (action === 'addTags' || action === 'removeTags') {
    const tags = splitTags($('bulk-tags').value);
    if (!tags.length) return t('admin.tags_required');
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
    if (action === 'delete') {
      for (const slug of slugs) changes[slug] = null;
    } else {
      const posts = await Promise.all(slugs.map((slug) => getPost(slug)));
      slugs.forEach((slug, index) => {
        if (!posts[index]) throw new Error(t('admin.post_missing', { slug }));
        changes[slug] = applyBulk(posts[index].text, options);
      });
    }
    await commitChanges(changes, t('admin.commit_message', { action: ACTION_LABELS[action], count }));

    // 一覧も変更後の内容に合わせる（index.json は次の反映で更新される）
    if (action === 'delete') {
      articles = articles.filter((item) => !slugs.includes(item.slug));
    } else {
      for (const item of articles) {
        if (!slugs.includes(item.slug)) continue;
        if (options.categories) item.categories = options.categories;
        if (options.addTags) item.tags = [...new Set([...(item.tags ?? []), ...options.addTags])];
        if (options.removeTags) item.tags = (item.tags ?? []).filter((tag) => !options.removeTags.includes(tag));
      }
    }
    selected.clear();
    fillCategoryOptions();
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
  $('admin-search').addEventListener('input', renderRows);
  $('admin-kind').addEventListener('change', renderRows);
  $('admin-all').addEventListener('change', () => {
    for (const item of visibleArticles()) {
      if ($('admin-all').checked) selected.add(item.slug);
      else selected.delete(item.slug);
    }
    renderRows();
  });
  $('bulk-action').addEventListener('change', updateBar);
  $('bulk-apply').addEventListener('click', apply);
}

// 絞り込み・一覧の選択・一括操作は全件読み終わってから有効にする（途中の件数だけで一括操作しないため）
let ready = false;
function setReady(on) {
  ready = on;
  for (const id of ['admin-search', 'admin-kind', 'admin-all']) $(id).disabled = !on;
  renderRows();
}

const byNewest = (items) => items.sort((a, b) => b.date.localeCompare(a.date));

async function load() {
  const indexUrl = document.querySelector('script[data-index-url]').dataset.indexUrl;
  try {
    const items = await loadIndex(indexUrl, {
      onPage: (read, total) => {
        articles = byNewest([...read]);
        fillCategoryOptions();
        renderRows();
        setStatus(t('admin.reading', { read: read.length, total }));
      },
    });
    articles = byNewest(items);
    fillCategoryOptions();
    setStatus('');
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
