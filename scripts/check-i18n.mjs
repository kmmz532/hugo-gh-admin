// 文言の辞書（data/gh-admin/i18n/*.toml）の確認。
// ・言語どうしのキーと差し込み（{name}）が揃っているか
// ・テンプレート（$i18n.<画面>.<項目>）と JS（t('<画面>.<項目>')）が使うキーが辞書にあるか
// TOML は `[section]` と `key = "value"` だけを読む。ほかの書き方はしない。Node の組み込みモジュールだけを使う。
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dictDir = join(root, 'data', 'gh-admin', 'i18n');
const errors = [];


// 拡張子 .js / .html の files を再帰的に集める
function listFiles(dir, exts) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(path, exts);
    return exts.some((ext) => entry.name.endsWith(ext)) ? [path] : [];
  });
}

function parseDict(file) {
  const dict = {};
  let section = null;
  readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, index) => {
    const text = line.trim();
    if (!text || text.startsWith('#')) return;
    const head = /^\[([a-z]+)\]$/.exec(text);
    if (head) {
      section = head[1];
      dict[section] ??= {};
      return;
    }
    const pair = /^([a-z_]+)\s*=\s*("(?:[^"\\]|\\.)*")$/.exec(text);
    if (!pair || section === null) {
      errors.push(`${relative(root, file)}:${index + 1}: 解釈できない行です`);
      return;
    }
    dict[section][pair[1]] = JSON.parse(pair[2]);
  });
  return dict;
}

const placeholders = (text) => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort().join(',');

const dicts = Object.fromEntries(
  readdirSync(dictDir)
    .filter((name) => name.endsWith('.toml'))
    .map((name) => [name.replace(/\.toml$/, ''), parseDict(join(dictDir, name))]),
);
if (!dicts.ja) errors.push('ja.toml がありません');

// キー（section.name）の一覧と値
const flatten = (dict) => new Map(Object.entries(dict).flatMap(([section, values]) => Object.entries(values).map(([name, value]) => [`${section}.${name}`, value])));
const flat = Object.fromEntries(Object.entries(dicts).map(([code, dict]) => [code, flatten(dict)]));

// 言語どうしの比較（ja を基準にする）
for (const [code, map] of Object.entries(flat)) {
  if (code === 'ja') continue;
  for (const key of flat.ja.keys()) if (!map.has(key)) errors.push(`${code}.toml: キーがありません: ${key}`);
  for (const key of map.keys()) if (!flat.ja.has(key)) errors.push(`${code}.toml: ja.toml にないキーです: ${key}`);
  for (const [key, value] of map) {
    if (flat.ja.has(key) && placeholders(flat.ja.get(key)) !== placeholders(value)) {
      errors.push(`${code}.toml: 差し込みの {name} が ja.toml と違います: ${key}`);
    }
  }
}

// テンプレート・JS が使っているキーを集める
const used = new Map();
const addUsed = (key, file) => {
  if (!used.has(key)) used.set(key, new Set());
  used.get(key).add(relative(root, file));
};
// t('key', { a, b: 値 }) の { } の中の名前（深さ 0 の , で分けた、: の前の部分）を並べる
function objectNames(text, open) {
  let depth = 0;
  let body = '';
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) depth--;
    if (depth === 0) break;
    if (depth >= 1 && !(i === open)) body += ch;
  }
  const names = [];
  let depth2 = 0;
  let current = '';
  for (const ch of `${body},`) {
    if (ch === ',' && depth2 === 0) {
      const name = current.split(':')[0].trim();
      if (name) names.push(name);
      current = '';
      continue;
    }
    if ('([{'.includes(ch)) depth2++;
    if (')]}'.includes(ch)) depth2--;
    current += ch;
  }
  return names.sort().join(',');
}

for (const file of listFiles(join(root, 'static', 'gh-admin', 'js'), ['.js'])) {
  const text = readFileSync(file, 'utf8');
  // t('key') または t('key', { ... })。差し込みの名前は辞書の {name} と合わせる
  for (const match of text.matchAll(/\bt\(\s*['"]([a-z]+\.[a-z_]+)['"]/g)) {
    const key = match[1];
    addUsed(key, file);
    const after = text.slice(match.index + match[0].length);
    const brace = /^\s*,\s*\{/.exec(after);
    const given = brace ? objectNames(text, match.index + match[0].length + brace[0].length - 1) : '';
    const ja = flat.ja?.get(key);
    if (ja !== undefined && placeholders(ja) !== given) {
      errors.push(`差し込みの名前が辞書と違います: ${key}（渡す: ${given || 'なし'} / 辞書: ${placeholders(ja) || 'なし'}、${relative(root, file)}）`);
    }
  }
}
for (const file of listFiles(join(root, 'layouts'), ['.html'])) {
  for (const match of readFileSync(file, 'utf8').matchAll(/\$i18n\.([a-z]+)\.([a-z_]+)/g)) addUsed(`${match[1]}.${match[2]}`, file);
}

for (const [key, files] of used) {
  for (const [code, map] of Object.entries(flat)) {
    if (!map.has(key)) errors.push(`${code}.toml にないキーを使っています: ${key}（${[...files].join(', ')}）`);
  }
}
// 使われていないキーは注意だけ（後の画面に移すキーがあるため）。一覧は --unused で出す
const unused = [...(flat.ja?.keys() ?? [])].filter((key) => !used.has(key));
for (const key of process.argv.includes('--unused') ? unused : []) console.warn(`注意: 使われていないキー: ${key}`);

for (const error of errors) console.error(`エラー: ${error}`);
console.log(`辞書: ${Object.keys(dicts).join(', ')} / キー ${flat.ja?.size ?? 0} 件 / 使用 ${used.size} 件 / 使われていないキー ${unused.length} 件 / エラー ${errors.length} 件`);
process.exitCode = errors.length ? 1 : 0;
