// /admin/settings/ のサイト設定画面。サイト本体リポジトリの読み書きは backend.js の siteFiles() を使う。
import { getToken, siteFiles, startBuild } from './backend.js';
import { t } from './i18n.js';

const $ = (id) => document.getElementById(id);
const settings = JSON.parse($('admin-settings-config').textContent);
const TOKEN_KEY = 'gh_admin_settings_token';
let token = sessionStorage.getItem(TOKEN_KEY) || getToken() || '';
// 読み込んだ設定ファイル（{ base64, version }）と、サイト本体リポジトリの読み書き
let configFile = null;
let files = null;

function status(id, message, error = false) {
  const el = $(id);
  el.textContent = message;
  el.classList.toggle('error', error);
}

function decodeBase64(value) {
  const binary = atob(value.replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function connect(candidate) {
  if (!candidate) throw new Error(t('settings.token_required'));
  token = candidate;
  files = siteFiles({ repo: settings.repo, branch: settings.branch }, token);
  if (!(await files.canPush())) {
    throw new Error(t('settings.repo_no_write', { repo: settings.repo }));
  }
  const file = await files.getFile(settings.path);
  if (!file) throw new Error(`${settings.path}: Not Found`);
  sessionStorage.setItem(TOKEN_KEY, token);
  configFile = file;
  for (const control of controls) await control.connect?.();
  loadForm(decodeBase64(file.base64));
  $('admin-settings-tabs').hidden = false;
  showTab('site');
  $('admin-settings-auth-form').hidden = true;
  status('admin-settings-auth-status', t('settings.connected', { repo: settings.repo }));
  status('admin-settings-status', '');
}

// この画面が変更する TOML キーだけを対象に、該当セクション内の行を置換する。
// TOML 全体を再シリアライズしないため、他の設定・コメント・順序を保持する。
// セクションは次のテーブル見出し（[table] と [[table]] のどちらも）の手前まで
const HEADER = /^\s*\[/;
const KEY_LINE = /^\s*([A-Za-z0-9_-]+)\s*=(.*)$/;

function sectionRange(lines, table) {
  const header = `[${table}]`;
  const start = lines.findIndex((line) => line.trim() === header);
  if (start < 0) return null;
  let end = lines.findIndex((line, index) => index > start && HEADER.test(line));
  if (end < 0) end = lines.length;
  return { start, end };
}

// table が空ならファイル先頭（最初の見出しの手前まで）
function scope(lines, table) {
  if (table) {
    const range = sectionRange(lines, table);
    return range ? { start: range.start + 1, end: range.end } : null;
  }
  const end = lines.findIndex((line) => HEADER.test(line));
  return { start: 0, end: end < 0 ? lines.length : end };
}

// 文字列・数値・真偽値だけを読む。それ以外（配列など）は undefined
function parseValue(raw) {
  const value = raw.trim();
  if (value.startsWith('"')) {
    try { return JSON.parse(value); } catch { return value.slice(1, value.lastIndexOf('"')); }
  }
  const bare = value.replace(/\s+#.*$/, '');
  if (bare === 'true' || bare === 'false') return bare === 'true';
  if (/^[+-]?\d+(\.\d+)?$/.test(bare)) return Number(bare);
  return undefined;
}

function literal(value) {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

function readValue(lines, key, table = '') {
  const range = scope(lines, table);
  if (!range) return undefined;
  const line = lines.slice(range.start, range.end).find((item) => KEY_LINE.exec(item)?.[1] === key);
  return line === undefined ? undefined : parseValue(line.slice(line.indexOf('=') + 1));
}

function readString(lines, key, table = '') {
  const value = readValue(lines, key, table);
  return typeof value === 'string' ? value : '';
}

// セクションの末尾の空行・コメント（次のセクションの説明）より前の位置
function sectionTail(lines, range) {
  let at = range.end;
  while (at > range.start && (!lines[at - 1].trim() || lines[at - 1].trim().startsWith('#'))) at--;
  return at;
}

function writeValue(lines, key, value, table = '') {
  const range = scope(lines, table);
  if (!range) {
    if (lines.length && lines.at(-1).trim()) lines.push('');
    lines.push(`[${table}]`, `  ${key} = ${literal(value)}`);
    return;
  }
  const index = lines.findIndex((line, i) => i >= range.start && i < range.end && KEY_LINE.exec(line)?.[1] === key);
  const indent = index >= 0 ? lines[index].match(/^\s*/)[0] : (table ? '  ' : '');
  const replacement = `${indent}${key} = ${literal(value)}`;
  if (index >= 0) lines[index] = replacement;
  else lines.splice(sectionTail(lines, range), 0, replacement);
}

const writeString = writeValue;

// テーブルの配列（[[params.links]] など）。各要素の key = value の行だけを読む
function readList(lines, path) {
  const header = `[[${path}]]`;
  const items = [];
  lines.forEach((line, index) => {
    if (line.trim() !== header) return;
    const item = {};
    for (let i = index + 1; i < lines.length && KEY_LINE.test(lines[i]); i++) {
      const [, key, raw] = KEY_LINE.exec(lines[i]);
      item[key] = parseValue(raw);
    }
    items.push(item);
  });
  return items;
}

// 既存の要素をすべて取り除き、最初の要素があった位置（なければ親のテーブルの末尾）に書き直す
function writeList(lines, path, items, columns) {
  const header = `[[${path}]]`;
  let at = -1;
  let indent = '';
  for (let i = 0; i < lines.length;) {
    if (lines[i].trim() !== header) { i++; continue; }
    if (at < 0) { at = i; indent = lines[i].match(/^\s*/)[0]; }
    let j = i + 1;
    while (j < lines.length && KEY_LINE.test(lines[j])) j++;
    lines.splice(i, j - i);
  }
  if (!items.length) return;
  if (at < 0) {
    const table = path.split('.').slice(0, -1).join('.');
    if (table && !sectionRange(lines, table)) {
      if (lines.length && lines.at(-1).trim()) lines.push('');
      lines.push(`[${table}]`);
    }
    at = table ? sectionTail(lines, scope(lines, table)) : lines.length;
    indent = table ? '  ' : '';
  }
  const block = items.flatMap((item) => [
    `${indent}${header}`,
    ...columns
      .filter((c) => item[c.key] !== '' && item[c.key] !== undefined)
      .map((c) => `${indent}  ${c.key} = ${literal(item[c.key])}`),
  ]);
  lines.splice(at, 0, ...block);
}

// 設定項目。本体の汎用の項目と、テーマが data/gh-admin/settings.toml の [[fields]] で定義する項目を同じ形で扱う。
// type: text / textarea / url / number / checkbox / select / list（テーブルの配列。columns に列を定義する）
const CORE_FIELDS = [
  { key: 'description', table: 'params', type: 'text', label: () => t('settings.description_label') },
  { key: 'author', table: 'params', type: 'text', label: () => t('settings.author_label') },
  { key: 'pagerSize', table: 'pagination', type: 'number', min: 1, max: 100, default: 10, label: () => t('settings.pager_size_label') },
  { key: 'languageCode', table: '', type: 'text', placeholder: 'ja', label: () => t('settings.language_label') },
];
const controls = [];

function fieldLabel(field) {
  const label = field.label;
  if (typeof label === 'function') return label();
  if (typeof label === 'string') return label;
  if (label && typeof label === 'object') return label[settings.lang] ?? label.en ?? Object.values(label)[0] ?? field.key;
  return field.key;
}

function createInput(field, id) {
  let input;
  if (field.type === 'textarea') {
    input = document.createElement('textarea');
    input.rows = 3;
  } else if (field.type === 'select') {
    input = document.createElement('select');
    for (const option of field.options ?? []) {
      const el = document.createElement('option');
      el.value = String(option.value);
      el.textContent = fieldLabel({ key: option.value, label: option.label });
      input.append(el);
    }
  } else {
    input = document.createElement('input');
    input.type = { url: 'url', number: 'number', checkbox: 'checkbox' }[field.type] ?? 'text';
    if (field.min !== undefined) input.min = field.min;
    if (field.max !== undefined) input.max = field.max;
  }
  if (id) input.id = id;
  if (field.placeholder) input.placeholder = field.placeholder;
  return input;
}

function inputValue(field, input) {
  if (field.type === 'checkbox') return input.checked;
  if (field.type === 'number') {
    const value = Number(input.value);
    if (!input.value || !Number.isFinite(value)) throw new Error(t('settings.number_invalid', { label: fieldLabel(field) }));
    return value;
  }
  return input.value.trim();
}

function setInputValue(field, input, value) {
  if (field.type === 'checkbox') input.checked = Boolean(value);
  else input.value = value ?? '';
}

function listRow(field, container, item = {}) {
  const row = document.createElement('div');
  row.className = 'admin-settings-list-row';
  row.inputs = field.columns.map((column) => {
    const input = createInput(column);
    input.setAttribute('aria-label', fieldLabel(column));
    if (column.type !== 'select' && column.type !== 'checkbox' && !column.placeholder) input.placeholder = fieldLabel(column);
    setInputValue(column, input, item[column.key] ?? column.default);
    row.append(input);
    return input;
  });
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'btn';
  remove.textContent = t('settings.list_remove');
  remove.addEventListener('click', () => row.remove());
  row.append(remove);
  container.append(row);
}

function renderList(field, parent) {
  const fieldset = document.createElement('fieldset');
  fieldset.className = 'field admin-settings-list';
  const legend = document.createElement('legend');
  legend.textContent = fieldLabel(field);
  const rows = document.createElement('div');
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'btn';
  add.textContent = t('settings.list_add');
  add.addEventListener('click', () => listRow(field, rows));
  fieldset.append(legend, rows, add);
  parent.append(fieldset);
  const path = field.table ? `${field.table}.${field.key}` : field.key;
  const normalize = (item) => Object.fromEntries(field.columns.map((c) => [c.key, item[c.key] ?? (c.type === 'checkbox' ? false : '')]));
  controls.push({
    load(lines) {
      rows.replaceChildren();
      for (const item of readList(lines, path)) listRow(field, rows, item);
    },
    save(lines) {
      const items = [...rows.children]
        .map((row) => Object.fromEntries(field.columns.map((c, i) => [c.key, inputValue(c, row.inputs[i])])))
        .filter((item) => field.columns.some((c) => c.type !== 'checkbox' && c.type !== 'select' && item[c.key] !== ''));
      if (JSON.stringify(items) === JSON.stringify(readList(lines, path).map(normalize))) return false;
      writeList(lines, path, items, field.columns);
      return true;
    },
  });
}

function renderField(field, parent) {
  if (field.type === 'list') {
    renderList(field, parent);
    return;
  }
  if (field.type === 'module') {
    renderModule(field, parent);
    return;
  }
  if (field.type === 'moduleversion') {
    renderModuleVersion(field, parent);
    return;
  }
  const table = field.table ?? '';
  const id = `admin-settings-field-${table || 'root'}-${field.key}`.replace(/[^A-Za-z0-9_-]/g, '-');
  const label = document.createElement('label');
  label.className = field.type === 'checkbox' ? 'field admin-settings-checkbox' : 'field';
  const input = createInput(field, id);
  if (field.type === 'checkbox') label.append(input, ` ${fieldLabel(field)}`);
  else label.append(fieldLabel(field), input);
  parent.append(label);
  const fallback = field.default ?? (field.type === 'checkbox' ? false : '');
  controls.push({
    load(lines) {
      setInputValue(field, input, readValue(lines, field.key, table) ?? fallback);
    },
    save(lines) {
      const value = inputValue(field, input);
      if (value === (readValue(lines, field.key, table) ?? fallback)) return false;
      writeValue(lines, field.key, value, table);
      // 言語を変えたときは、既定の言語（ja-jp → ja）も合わせる
      if (field.key === 'languageCode' && !table && readValue(lines, 'defaultContentLanguage') !== undefined) {
        writeValue(lines, 'defaultContentLanguage', value.split('-')[0].toLowerCase());
      }
      return true;
    },
  });
}

// Hugo Modules。[[module.imports]] の path と、go.mod の require を扱う
function readModuleImports(lines) {
  return readList(lines, 'module.imports').map((item) => item.path).filter((path) => typeof path === 'string');
}

function replaceModuleImport(lines, from, to) {
  let inImport = false;
  for (let i = 0; i < lines.length; i++) {
    if (HEADER.test(lines[i])) { inImport = lines[i].trim() === '[[module.imports]]'; continue; }
    const match = inImport && KEY_LINE.exec(lines[i]);
    if (match && match[1] === 'path' && parseValue(match[2]) === from) {
      lines[i] = `${lines[i].match(/^\s*/)[0]}path = ${literal(to)}`;
      return true;
    }
  }
  return false;
}

// go.mod の require（パス → 版）。require ( ... ) と require <path> <version> の両方を読む
function readGoRequires(text) {
  const requires = new Map();
  let inBlock = false;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^require\s*\($/.test(trimmed)) { inBlock = true; continue; }
    if (inBlock && trimmed === ')') { inBlock = false; continue; }
    const match = inBlock ? /^(\S+)\s+(\S+)/.exec(trimmed) : /^require\s+(\S+)\s+(\S+)/.exec(trimmed);
    if (match && !match[1].startsWith('//')) requires.set(match[1], match[2]);
  }
  return requires;
}

// prefix で始まるモジュールの require を取り除き、entries（[パス, 版]）を追加する
function writeGoRequires(text, prefix, entries) {
  const out = [];
  let inBlock = false;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^require\s*\($/.test(trimmed)) { inBlock = true; out.push(line); continue; }
    if (inBlock && trimmed === ')') {
      inBlock = false;
      // 空になった require ( ) は消す
      if (/^require\s*\($/.test(out.at(-1)?.trim() ?? '')) out.pop();
      else out.push(line);
      continue;
    }
    const match = inBlock ? /^(\S+)\s+\S+/.exec(trimmed) : /^require\s+(\S+)\s+\S+/.exec(trimmed);
    if (match && match[1].startsWith(prefix)) continue;
    out.push(line);
  }
  while (out.length && !out.at(-1).trim()) out.pop();
  if (entries.length) out.push('', 'require (', ...entries.map(([path, version]) => `\t${path} ${version}`), ')');
  return `${out.join('\n')}\n`;
}

// GitHub のリポジトリの最新コミットから Go modules の疑似バージョンを作る（例: v0.0.0-20261126012345-0123456789ab）
async function latestPseudoVersion(source, branch = 'main') {
  const res = await fetch(`https://api.github.com/repos/${source}/commits/${encodeURIComponent(branch)}`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(t('settings.module_version_failed', { message: `${res.status} ${res.statusText}` }));
  const data = await res.json();
  const time = new Date(data.commit.committer.date).toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return `v0.0.0-${time}-${data.sha.slice(0, 12)}`;
}

// type = "module": [[module.imports]] のうち options のどれかに一致する path を切り替える（テーマの切り替えなど）
function renderModule(field, parent) {
  const label = document.createElement('label');
  label.className = 'field';
  const input = createInput({ ...field, type: 'select' });
  label.append(fieldLabel(field), input);
  parent.append(label);
  const values = (field.options ?? []).map((option) => String(option.value));
  const current = (lines) => readModuleImports(lines).find((path) => values.includes(path));
  controls.push({
    load(lines) {
      const path = current(lines);
      label.hidden = !path;
      if (path) input.value = path;
    },
    save(lines) {
      const from = current(lines);
      if (!from || input.value === from) return false;
      return replaceModuleImport(lines, from, input.value);
    },
  });
}

// type = "moduleversion": go.mod で prefix に一致するモジュールの版を固定するか（自動で更新するか）を切り替える。
// 固定する対象は [[module.imports]] のうち prefix に一致するものと modules に書いたもの。版は source（GitHub の owner/repo）の最新コミット
function renderModuleVersion(field, parent) {
  const prefix = field.prefix ?? '';
  const file = field.file ?? 'go.mod';
  const auto = document.createElement('label');
  auto.className = 'field admin-settings-checkbox';
  const autoInput = createInput({ type: 'checkbox' });
  auto.append(autoInput, ` ${fieldLabel(field)}`);
  const update = document.createElement('label');
  update.className = 'field admin-settings-checkbox';
  const updateInput = createInput({ type: 'checkbox' });
  update.append(updateInput, ` ${t('settings.module_update')}`);
  const note = document.createElement('p');
  note.className = 'admin-note';
  parent.append(auto, note, update);
  let goMod = null;
  const pinned = () => [...readGoRequires(goMod?.text ?? '')].filter(([path]) => path.startsWith(prefix));
  const refresh = () => {
    const versions = [...new Set(pinned().map(([, version]) => version))];
    note.textContent = autoInput.checked
      ? t('settings.module_auto_hint')
      : versions.length ? t('settings.module_pinned_hint', { version: versions.join(', ') }) : t('settings.module_pin_hint');
    update.hidden = autoInput.checked || versions.length === 0;
  };
  autoInput.addEventListener('change', refresh);
  controls.push({
    async connect() {
      const found = await files.getFile(file);
      goMod = found ? { text: decodeBase64(found.base64), version: found.version } : null;
    },
    load() {
      const available = goMod !== null && Boolean(field.source);
      auto.hidden = !available;
      note.hidden = !available;
      autoInput.checked = pinned().length === 0;
      updateInput.checked = false;
      if (available) refresh();
      else update.hidden = true;
    },
    // hugo.toml の変更（テーマの切り替え）を反映したあとの lines から、固定するモジュールを決める
    async save(lines) {
      if (!goMod || !field.source) return false;
      const modules = [...new Set([...(field.modules ?? []), ...readModuleImports(lines).filter((path) => path.startsWith(prefix))])];
      const current = pinned();
      let entries = [];
      if (!autoInput.checked) {
        const version = updateInput.checked || current.length === 0
          ? await latestPseudoVersion(field.source, field.branch)
          : current[0][1];
        entries = modules.map((path) => [path, version]);
      }
      const text = writeGoRequires(goMod.text, prefix, entries);
      if (text === goMod.text) return false;
      await files.putFile(file, encodeBase64(text), 'Update theme version', goMod.version);
      const saved = await files.getFile(file);
      goMod = { text, version: saved?.version };
      return 'file';
    },
  });
}

function renderFields() {
  CORE_FIELDS.forEach((field) => renderField(field, $('admin-settings-core-fields')));
  const themeFields = (settings.fields ?? []).filter((field) => field?.key && (field.type !== 'list' || Array.isArray(field.columns)));
  themeFields.forEach((field) => renderField(field, $('admin-settings-theme-fields')));
  $('admin-settings-theme-section').hidden = themeFields.length === 0;
}

function showPreview(id, path) {
  const image = $(id === 'icon' ? 'admin-settings-icon-preview' : 'admin-settings-thumbnail-preview');
  const label = $(id === 'icon' ? 'admin-settings-icon-path' : 'admin-settings-thumbnail-path');
  label.textContent = path || '未設定';
  if (path) {
    image.src = new URL(path, location.origin).href;
    image.hidden = false;
  } else {
    image.removeAttribute('src');
    image.hidden = true;
  }
}

function loadForm(text) {
  const lines = text.split(/\r?\n/);
  $('admin-settings-title').value = readString(lines, 'title');
  for (const control of controls) control.load(lines);
  showPreview('icon', readString(lines, 'icon', 'params'));
  showPreview('thumbnail', readString(lines, 'defaultThumbnail', 'params'));
}

async function uploadAsset(file, prefix, allowedExtensions, maxSize) {
  const extension = file.name.split('.').pop().toLowerCase();
  if (!allowedExtensions.includes(extension)) throw new Error(t('settings.extension_unsupported', { extensions: allowedExtensions.join('・') }));
  if (file.size > maxSize) throw new Error(t('settings.file_too_large', { size: Math.floor(maxSize / 1024 / 1024) }));

  const path = `static/${prefix}.${extension}`;
  const existing = await files.getFile(path);
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  try {
    await files.putFile(path, btoa(binary), `Update site ${prefix}`, existing?.version);
  } catch (error) {
    if (error.writeDenied) throw error;
    throw new Error(`${t('settings.upload_failed')} (${error.message})`);
  }
  return `/${path.slice('static/'.length)}`;
}

$('admin-settings-auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  status('admin-settings-auth-status', t('settings.connecting'));
  try {
    await connect($('admin-settings-token').value.trim());
  } catch (error) {
    status('admin-settings-auth-status', error.message, true);
  }
});

$('admin-settings-settings-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('admin-settings-settings-form').querySelector('button[type="submit"]');
  button.disabled = true;
  status('admin-settings-status', t('settings.saving'));
  try {
    const lines = decodeBase64(configFile.base64).split(/\r?\n/);
    let configChanged = false;
    const title = $('admin-settings-title').value.trim();
    if (!title) throw new Error(t('settings.title_required'));
    if (title !== readString(lines, 'title')) {
      writeString(lines, 'title', title);
      configChanged = true;
    }

    // go.mod など設定ファイル以外を変更した項目は、その場で個別にコミットする
    let otherChanged = false;
    for (const control of controls) {
      const changed = await control.save(lines);
      if (changed === 'file') otherChanged = true;
      else if (changed) configChanged = true;
    }

    const favicon = $('admin-settings-favicon').files[0];
    if (favicon) {
      const iconPath = await uploadAsset(favicon, 'favicon', ['ico', 'png', 'svg'], 1024 * 1024);
      if (iconPath !== readString(lines, 'icon', 'params')) {
        writeString(lines, 'icon', iconPath, 'params');
        configChanged = true;
      }
      if (favicon.name.toLowerCase().endsWith('.png') && iconPath !== readString(lines, 'appleIcon', 'params')) {
        writeString(lines, 'appleIcon', iconPath, 'params');
        configChanged = true;
      }
    }

    const thumbnail = $('admin-settings-thumbnail').files[0];
    if (thumbnail) {
      const thumbnailPath = await uploadAsset(thumbnail, 'default-thumbnail', ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'], 5 * 1024 * 1024);
      if (thumbnailPath !== readString(lines, 'defaultThumbnail', 'params')) {
        writeString(lines, 'defaultThumbnail', thumbnailPath, 'params');
        configChanged = true;
      }
    } else if ($('admin-settings-clear-thumbnail').checked && readString(lines, 'defaultThumbnail', 'params')) {
      writeString(lines, 'defaultThumbnail', '', 'params');
      configChanged = true;
    }

    let commit = otherChanged ? '完了' : '変更なし';
    if (configChanged) {
      const result = await files.putFile(settings.path, encodeBase64(lines.join('\n')), 'Update site settings', configFile.version);
      configFile = await files.getFile(settings.path);
      commit = result || '完了';
    }
    loadForm(lines.join('\n'));
    $('admin-settings-favicon').value = '';
    $('admin-settings-thumbnail').value = '';
    $('admin-settings-clear-thumbnail').checked = false;
    status('admin-settings-status', t('settings.saved', { commit }));
  } catch (error) {
    if (error.writeDenied) {
      // サイト設定用の権限が足りない場合、別のトークンを入力し直せるようにする。
      sessionStorage.removeItem(TOKEN_KEY);
      $('admin-settings-settings-form').hidden = true;
      $('admin-settings-version').hidden = true;
      $('admin-settings-tabs').hidden = true;
      $('admin-settings-auth-form').hidden = false;
      $('admin-settings-token').value = '';
      status('admin-settings-auth-status', error.message, true);
      status('admin-settings-status', '');
    } else {
      status('admin-settings-status', error.message, true);
    }
  } finally {
    button.disabled = false;
  }
});

// サイト設定とバージョンのタブ
function showTab(name) {
  const site = name === 'site';
  $('admin-settings-settings-form').hidden = !site;
  $('admin-settings-version').hidden = site;
  $('admin-settings-tab-site').setAttribute('aria-selected', String(site));
  $('admin-settings-tab-version').setAttribute('aria-selected', String(!site));
  if (!site) loadVersions();
}
$('admin-settings-tab-site').addEventListener('click', () => showTab('site'));
$('admin-settings-tab-version').addEventListener('click', () => showTab('version'));

// GitHub にあるモジュール（github.com/<owner>/<repo>/...）の最新の版。タグの版ならタグ、疑似バージョン（v0.0.0-日時-SHA）なら既定のブランチの最新コミットと比べる
async function latestVersion(path, version) {
  const match = /^github\.com\/([^/]+)\/([^/]+)/.exec(path);
  if (!match) return null;
  const repo = `${match[1]}/${match[2]}`;
  const pseudo = /^v0\.0\.0-\d{14}-([0-9a-f]{12})$/.exec(version ?? '');
  if (pseudo || !version) {
    const res = await fetch(`https://api.github.com/repos/${repo}/commits/HEAD`, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) return null;
    const data = await res.json();
    const time = new Date(data.commit.committer.date).toISOString().replace(/[-:T]/g, '').slice(0, 14);
    return { label: `v0.0.0-${time}-${data.sha.slice(0, 12)}`, same: pseudo ? data.sha.startsWith(pseudo[1]) : null };
  }
  const res = await fetch(`https://api.github.com/repos/${repo}/tags?per_page=100`, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) return null;
  const parse = (v) => (/^v(\d+)\.(\d+)\.(\d+)$/.exec(v) ?? []).slice(1).map(Number);
  const tags = (await res.json()).map((tag) => tag.name).filter((name) => parse(name).length === 3)
    .sort((a, b) => { const x = parse(a); const y = parse(b); return y[0] - x[0] || y[1] - x[1] || y[2] - x[2]; });
  return tags[0] ? { label: tags[0], same: tags[0] === version } : null;
}

let versionsLoaded = false;
async function loadVersions() {
  if (versionsLoaded) return;
  versionsLoaded = true;
  const rows = $('admin-settings-version-rows');
  rows.replaceChildren();
  for (const module of settings.modules ?? []) {
    const row = document.createElement('tr');
    const cells = [module.path, module.version || t('settings.version_local'), t('common.loading')].map((text) => {
      const cell = document.createElement('td');
      cell.textContent = text;
      row.append(cell);
      return cell;
    });
    rows.append(row);
    latestVersion(module.path, module.version).then((latest) => {
      cells[2].textContent = !latest ? '-' : latest.same ? t('settings.version_up_to_date') : latest.label;
      if (latest && latest.same === false) row.classList.add('outdated');
    }).catch(() => { cells[2].textContent = '-'; });
  }
}

$('admin-settings-rebuild')?.addEventListener('click', async () => {
  if (!window.confirm(t('settings.rebuild_confirm'))) return;
  const button = $('admin-settings-rebuild');
  button.disabled = true;
  status('admin-settings-version-status', t('settings.rebuild_starting'));
  try {
    const url = await startBuild({ repo: settings.buildRepo, branch: settings.buildBranch }, token, settings.buildWorkflow);
    const el = $('admin-settings-version-status');
    el.classList.remove('error');
    el.textContent = `${t('settings.rebuild_started')} `;
    if (url) {
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = t('settings.rebuild_log');
      el.append(link);
    }
  } catch (error) {
    status('admin-settings-version-status', t('settings.rebuild_failed', { message: error.message }), true);
  } finally {
    button.disabled = false;
  }
});

renderFields();

if (token) {
  connect(token).catch((error) => {
    status('admin-settings-auth-status', t('settings.saved_token_invalid', { message: error.message }), true);
    $('admin-settings-auth-form').hidden = false;
  });
} else {
  $('admin-settings-auth-form').hidden = false;
}
