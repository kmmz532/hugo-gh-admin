// /admin/update/ のモジュールの管理。hugo.toml の [[module.imports]] の追加・削除・並べ替えと、
// go.mod でのバージョンの固定（空欄なら固定せず、ビルドのたびに最新バージョンを利用する）を行う
import { getToken, siteFiles } from './backend.js';
import { t } from './i18n.js';
import {
  ADMIN_MODULE, HUGO_THEMES_LIST_URL, IMPORT_HEADER, decodeBase64, encodeBase64, importBlocks, latestModuleVersion,
  normalizeThemeModule, parseThemesList, readGoRequires, setGoRequires, writeImportBlocks,
} from './site-config.js';

const $ = (id) => document.getElementById(id);
const settings = JSON.parse($('admin-update-config').textContent);
const token = sessionStorage.getItem('gh_admin_settings_token') || getToken() || '';

const newBlock = (path) => ({ path, text: [IMPORT_HEADER, `  path = ${JSON.stringify(path)}`] });

function status(message, error = false) {
  const el = $('admin-modules-status');
  el.textContent = message;
  el.classList.toggle('error', error);
}

async function main() {
  const section = $('admin-modules');
  if (!section) return;
  section.hidden = false;
  if (!settings.siteRepo) {
    status(t('settings.modules_no_repo'));
    return;
  }
  if (!token) {
    status(t('settings.update_login'));
    return;
  }
  const files = siteFiles({ repo: settings.siteRepo, branch: settings.siteBranch }, token);
  let config;
  let goMod;
  let blocks = [];
  // パス → 固定するバージョン（空なら固定しない）
  let versions = new Map();

  async function load() {
    config = await files.getFile(settings.siteConfigPath);
    if (!config) throw new Error(t('settings.modules_no_config', { path: settings.siteConfigPath }));
    goMod = await files.getFile('go.mod');
    const lines = decodeBase64(config.base64).split(/\r?\n/);
    blocks = importBlocks(lines).map(({ path, text }) => ({ path, text }));
    const requires = goMod ? readGoRequires(decodeBase64(goMod.base64)) : new Map();
    versions = new Map(blocks.map(({ path }) => [path, requires.get(path) ?? '']));
    render();
  }

  function move(index, offset) {
    const [block] = blocks.splice(index, 1);
    blocks.splice(index + offset, 0, block);
    render();
  }

  function button(text, label, onClick, disabled = false) {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'btn';
    element.textContent = text;
    element.setAttribute('aria-label', label);
    element.disabled = disabled;
    element.addEventListener('click', onClick);
    return element;
  }

  function render() {
    $('admin-modules-rows').replaceChildren(
      ...blocks.map((block, index) => {
        const row = document.createElement('tr');
        const pathCell = document.createElement('td');
        pathCell.textContent = block.path || t('settings.modules_no_path');
        if (index === blocks.findIndex(({ path }) => path !== ADMIN_MODULE)) {
          const badge = document.createElement('span');
          badge.className = 'admin-modules-badge';
          badge.textContent = t('settings.modules_theme');
          pathCell.append(' ', badge);
        }

        const versionCell = document.createElement('td');
        const input = document.createElement('input');
        input.type = 'text';
        input.value = versions.get(block.path) ?? '';
        input.placeholder = t('settings.modules_auto');
        input.setAttribute('aria-label', t('settings.modules_version_label', { path: block.path }));
        input.disabled = !goMod || !block.path;
        input.addEventListener('input', () => versions.set(block.path, input.value.trim()));
        const latest = button(t('settings.modules_latest'), t('settings.modules_latest_label', { path: block.path }), async () => {
          latest.disabled = true;
          try {
            const found = await latestModuleVersion(block.path, versions.get(block.path) || '');
            if (!found) throw new Error(t('settings.modules_latest_failed'));
            input.value = found.label;
            versions.set(block.path, found.label);
          } catch (error) {
            status(error.message, true);
          } finally {
            latest.disabled = false;
          }
        }, input.disabled);
        versionCell.append(input, ' ', latest);

        const actions = document.createElement('td');
        actions.className = 'admin-modules-actions';
        actions.append(
          button('↑', t('settings.modules_up_label', { path: block.path }), () => move(index, -1), index === 0),
          button('↓', t('settings.modules_down_label', { path: block.path }), () => move(index, 1), index === blocks.length - 1),
          button(t('settings.modules_remove'), t('settings.modules_remove_label', { path: block.path }), () => {
            if (!confirm(t('settings.modules_remove_confirm', { path: block.path }))) return;
            blocks.splice(index, 1);
            render();
          }, block.path === ADMIN_MODULE),
        );
        row.append(pathCell, versionCell, actions);
        return row;
      }),
    );
    $('admin-modules-gomod').hidden = Boolean(goMod);
  }

  // themes.gohugo.io の一覧は、追加の入力欄を初めて使うときに読む。読めなくても入力はできる
  let themes = [];
  $('admin-modules-add-input').addEventListener('focus', async () => {
    if (themes.length) return;
    try {
      const res = await fetch(HUGO_THEMES_LIST_URL);
      if (!res.ok) return;
      themes = parseThemesList(await res.text());
      $('admin-modules-themes').replaceChildren(...themes.map((path) => Object.assign(document.createElement('option'), { value: path })));
    } catch {
      // 一覧が無くても、パスや URL を入力すれば追加できる
    }
  }, { once: true });

  $('admin-modules-add').addEventListener('click', () => {
    const input = $('admin-modules-add-input');
    const path = normalizeThemeModule(input.value, themes);
    if (!path) {
      status(t('settings.modules_invalid'), true);
      return;
    }
    if (blocks.some((block) => block.path === path)) {
      status(t('settings.modules_duplicate', { path }), true);
      return;
    }
    blocks.push(newBlock(path));
    versions.set(path, '');
    input.value = '';
    status('');
    render();
  });

  $('admin-modules-save').addEventListener('click', async () => {
    const save = $('admin-modules-save');
    save.disabled = true;
    status(t('settings.saving'));
    try {
      let changed = false;
      if (goMod) {
        const before = decodeBase64(goMod.base64);
        const kept = new Set(blocks.map(({ path }) => path));
        // 取り除いたモジュールと、空欄にしたモジュールの require は消す。テーマ経由の require は触らない
        const requires = readGoRequires(before);
        const entries = new Map([...versions].filter(([path]) => path && (kept.has(path) || requires.has(path)))
          .map(([path, version]) => [path, kept.has(path) ? version : '']));
        const after = setGoRequires(before, entries);
        if (after !== before) {
          await files.putFile('go.mod', encodeBase64(after), 'Update Hugo modules', goMod.version);
          changed = true;
        }
      }
      const lines = decodeBase64(config.base64).split(/\r?\n/);
      const before = lines.join('\n');
      writeImportBlocks(lines, blocks);
      const after = lines.join('\n');
      if (after !== before) {
        await files.putFile(settings.siteConfigPath, encodeBase64(after), 'Update Hugo modules', config.version);
        changed = true;
      }
      await load();
      status(changed ? t('settings.modules_saved') : t('settings.pin_unchanged'));
    } catch (error) {
      status(error.message, true);
    } finally {
      save.disabled = false;
    }
  });

  try {
    await load();
    $('admin-modules-form').hidden = false;
  } catch (error) {
    status(error.message, true);
  }
}

main();
