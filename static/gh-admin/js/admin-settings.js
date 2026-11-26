// /admin/settings/ のサイト設定画面。サイト本体リポジトリの読み書きは backend.js の siteFiles() を使う。
import { getToken, siteFiles } from './backend.js';
import { t } from './i18n.js';
import {
  HEADER, KEY_LINE, decodeBase64, encodeBase64, latestPseudoVersion, literal, parseValue, readGoRequires, readList, readModuleImports, readString, readValue, replaceModuleImport, scope, sectionRange, sectionTail, writeGoRequires, writeList, writeString, writeValue,
  HUGO_THEMES_LIST_URL, currentTheme, ensureAdminImport, normalizeThemeModule, parseThemesList,
} from './site-config.js';

// 外部テーマのページに管理ボタンを差し込むスクリプト（Blogit が作成する）。無ければ、外部テーマでは管理ボタンが出ない
const FLOAT_SCRIPT = 'scripts/gh-admin-float.sh';

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
  $('admin-settings-settings-form').hidden = false;
  $('admin-settings-auth-form').hidden = true;
  status('admin-settings-auth-status', t('settings.connected', { repo: settings.repo }));
  status('admin-settings-status', '');
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
  // バージョンの固定（moduleversion）は更新の画面（admin-update.js）で扱う
  if (field.type === 'moduleversion') return;
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

// テーマの切り替え。[[module.imports]] のうち管理画面以外の先頭のモジュールを置き換える。
// テーマが type = "module" の項目を定義していれば、その選択肢を候補の先頭に出す（その項目は別に表示しない）。
// 候補にないテーマ（外部テーマ）に切り替えるときは、管理画面のモジュールの取り込みを追加する
function renderTheme(parent) {
  const presets = (settings.fields ?? [])
    .filter((field) => field?.type === 'module')
    .flatMap((field) => field.options ?? [])
    .map((option) => ({ value: String(option.value), label: fieldLabel({ key: option.value, label: option.label }) }));
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const label = document.createElement('label');
  label.htmlFor = 'admin-settings-theme';
  label.textContent = t('settings.theme_label');
  const input = createInput({ type: 'text', placeholder: 'https://github.com/owner/hugo-theme' }, 'admin-settings-theme');
  input.setAttribute('list', 'admin-settings-theme-list');
  input.autocomplete = 'off';
  input.spellcheck = false;
  const list = document.createElement('datalist');
  list.id = 'admin-settings-theme-list';
  const addOption = (value, text) => {
    const option = document.createElement('option');
    option.value = value;
    if (text) option.label = text;
    list.append(option);
  };
  for (const preset of presets) addOption(preset.value, preset.label);
  const hint = document.createElement('p');
  hint.className = 'admin-note';
  hint.textContent = t('settings.theme_hint');
  const resolved = document.createElement('p');
  resolved.className = 'admin-note';
  resolved.hidden = true;
  const missing = document.createElement('p');
  missing.className = 'admin-note';
  missing.textContent = t('settings.theme_no_float', { path: FLOAT_SCRIPT });
  missing.hidden = true;
  wrap.append(label, input, list, resolved, hint, missing);
  parent.prepend(wrap);

  // themes.gohugo.io の一覧は、入力欄を初めて使うときに読む。読めなくても入力はできる
  let themes = [];
  let loaded = false;
  input.addEventListener('focus', () => {
    if (loaded) return;
    loaded = true;
    fetch(HUGO_THEMES_LIST_URL)
      .then((res) => (res.ok ? res.text() : ''))
      .then((text) => {
        themes = parseThemesList(text);
        for (const path of themes) addOption(path);
      })
      .catch(() => {});
  });
  // 管理ボタンを差し込むスクリプトの有無は、外部テーマ（候補にないテーマ）のときだけ確認する。
  // Blogit のテーマは管理ボタンを組み込んでいるため不要で、無いファイルを読みに行くと 404 がコンソールに出る
  let floatScript = null;
  async function checkFloat(path) {
    const external = Boolean(path) && !presets.some((preset) => preset.value === path);
    if (!external || !files) {
      missing.hidden = true;
      return;
    }
    try {
      floatScript ??= files.getFile(FLOAT_SCRIPT).then(Boolean);
      missing.hidden = await floatScript;
    } catch {
      missing.hidden = true;
    }
  }
  input.addEventListener('input', () => {
    const path = normalizeThemeModule(input.value, themes);
    resolved.hidden = !path || path === input.value.trim();
    resolved.textContent = path ? t('settings.theme_resolved', { path }) : '';
  });
  input.addEventListener('change', () => checkFloat(normalizeThemeModule(input.value, themes)));

  controls.push({
    async connect() {
      floatScript = null;
    },
    load(lines) {
      const path = currentTheme(lines);
      wrap.hidden = !path;
      input.value = path ?? '';
      resolved.hidden = true;
      checkFloat(path);
    },
    save(lines) {
      const from = currentTheme(lines);
      if (!from) return false;
      const to = normalizeThemeModule(input.value, themes);
      if (!to) throw new Error(t('settings.theme_invalid'));
      if (to === from) return false;
      // 候補（テーマが定義した選択肢）のテーマは、管理画面の部品を組み込んでいる
      const integrated = presets.some((preset) => preset.value === to);
      if (!integrated && !confirm(t('settings.theme_confirm', { path: to }))) throw new Error(t('settings.theme_cancelled'));
      replaceModuleImport(lines, from, to);
      if (!integrated) ensureAdminImport(lines);
      return true;
    },
  });
}

function renderFields() {
  CORE_FIELDS.forEach((field) => renderField(field, $('admin-settings-core-fields')));
  renderTheme($('admin-settings-core-fields'));
  // テーマの切り替え（type = "module"）は renderTheme が扱う
  const themeFields = (settings.fields ?? []).filter((field) => field?.key && field.type !== 'module' && (field.type !== 'list' || Array.isArray(field.columns)));
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

renderFields();

if (token) {
  connect(token).catch((error) => {
    status('admin-settings-auth-status', t('settings.saved_token_invalid', { message: error.message }), true);
    $('admin-settings-auth-form').hidden = false;
  });
} else {
  $('admin-settings-auth-form').hidden = false;
}
