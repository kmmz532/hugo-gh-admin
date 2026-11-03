# hugo-gh-admin

Hugo サイトに、GitHub 上の Markdown 記事をブラウザから編集する機能を足す Hugo Modules の部品です。ログイン（Personal Access Token）・記事の新規作成と編集・一括管理・画像の管理・保存直後の「反映待ち」表示を含みます。

- 保存先は GitHub リポジトリ。記事は `content/posts/<slug>.md` の形で保存します。
- 画面は日本語だけです（多言語には対応していません）。
- サイト本体のテーマに合わせて作る部品です。見た目は本体のテーマが決めます。

## 必要なもの

- Hugo 0.141.0 以上の extended 版
- Go（Hugo Modules の取り込みに使う）
- 記事を置く GitHub リポジトリ（以下「記事のリポジトリ」）と、その Contents への読み書き権限を持つ Personal Access Token

## 取り込み方

本体の `go.mod` と `hugo.toml` に入れます。

```toml
[[module.imports]]
  path = "github.com/kmmz532/hugo-gh-admin"
```

```sh
hugo mod get github.com/kmmz532/hugo-gh-admin@v0.1.0
```

版は必ずタグで固定してください。`hugo mod get -u` で更新する前に、変更の差分を読んでください。

## 設定（`params.ghAdmin`）

`hugo.toml` の `[params.ghAdmin]` に書きます。書かなかった項目は既定値を使います（既定値は `layouts/partials/gh-admin/settings.html` にだけ書かれています）。

| 項目 | 既定値 | 意味 |
|---|---|---|
| `repo` | （なし） | 記事のリポジトリ。`owner/name` の形 |
| `branch` | `main` | 記事を保存するブランチ |
| `postsDir` | `content/posts` | 記事を置くフォルダ |
| `imagesDir` | `static/images` | 画像を置くフォルダ |
| `imagesURL` | `/images/` | 記事に書く画像の URL の前置き（`relURL` を通す） |
| `defaultCategory` | `tech` | 新規記事の既定のカテゴリ |
| `editURL` | `/edit/` | 編集画面の URL |
| `loginURL` | `/login/` | ログイン画面の URL |
| `adminURL` | `/admin/` | 一括管理の URL |
| `adminImagesURL` | `/admin/images/` | 画像の管理の URL |

画面の URL を変えたいときは、本体に同じパスの `content/*.md` を置いて `url:` を上書きし、この項目も同じ URL にそろえます。

```toml
[params.ghAdmin]
  repo = "owner/articles"
  branch = "main"
```

## 本体（テーマ）との接点

本体は次の partial だけを呼びます。ほかのファイルやクラス名には頼りません。

| partial | 呼ぶ場所 | 引数 | 役目 |
|---|---|---|---|
| `gh-admin/head.html` | `<head>` の中（CSS の bundle の後） | `.` | 設定の `<meta name="gh-admin">`、編集画面の CSS、`admin.js` |
| `gh-admin/csp.html` | CSP の `script-src` を組むところ | `.` | そのページで足す送り先（編集画面だけ cdnjs） |
| `gh-admin/button.html` | ヘッダー・記事カード・フッター | `dict "kind" "edit\|new\|admin\|login\|logout\|footer" "page" . "class" "..." "label" "..."` | 管理画面への入口のボタン |
| `gh-admin/article-scripts.html` | 記事詳細の `scripts` ブロック | `.` | コードのコピーボタンの読み込み |

`csp.html` は `script-src` の値の続きを返します（前に空白を付けて返し、末尾に改行を出さない）。

## テーマが用意するもの（契約）

部品は次を前提にします。本体のテーマで用意してください。

### 反映待ちの雛形

`<template id="gh-admin-pending-card">`（一覧のカード）と `<template id="gh-admin-pending-article">`（記事詳細）を、ページの `<body>` に出します。`pending.js` は雛形を複製し、次の要素に値を入れます。

- `data-field="thumb|band|date|categories|title|external|source|summary|tags|edit|crumbs|body"`: 値を入れる要素（`textContent`・`src`・`href` だけを使う）
- `data-item="tag|crumb"`: 項目の数だけ複製される入れ子の雛形
- 差し込み先: 一覧は `[data-pending-target="list"]`、記事の差し替えは `[data-pending-target="article"]`（404 の箱）、記事詳細は `article[data-slug]`

雛形が無いページでは、反映待ちの帯だけを出します。

### クラス名と CSS 変数

- 見出しは `.page-title`、記事の見出しは `.post-title`、本文の箱は `.post-body`（プレビューも同じクラスを使う）
- 編集画面の CSS（`assets/gh-admin/editor.css`）は次の CSS 変数を使う。本体のテーマで定義してください。
  `--text-primary`・`--text-secondary`・`--foreground`・`--foreground-rgb`・`--background`・`--border`・`--link`・`--danger`
- 数式の描画（編集画面のプレビュー）は `lib/marked.min.js`（本体の `static/lib/`）を読みます。

### 索引

- 管理画面は `/gh-admin/index.json` を読みます（1 ファイル 50 件まで。`next` をたどる）。項目は `slug`・`title`・`url`・`date`・`external`・`images`・`tags`・`categories`。
- 検索用の `/index.json` は本体の仕事です。

## フロントマター（スキーマの前提）

管理画面は次の項目だけを読み書きします。ほかの項目は消さずに残しますが、画面からは扱いません。

`title`・`date`・`lastmod`・`categories`・`tags`・`summary`・`image`・`aliases`・`external`・`source`・`build`・`sitemap`

スキーマは固定です（設定では変えられません）。

## 版の約束

- 版は [Semantic Versioning](https://semver.org/lang/ja/) に従い、タグで示します（`v0.1.0` など）。
- 次を変えるときはメジャー版を上げ、`CHANGELOG.md` に書きます: `params.ghAdmin` の項目、partial の名前と引数、テーマが用意する雛形の `id` と `data-field`、CSS 変数とクラス名、索引の JSON の形。
- 契約に触れない修正は、マイナー版かパッチ版にします。

## セキュリティ

- Personal Access Token はブラウザの `localStorage` に保存されます。共有の端末では使わないでください。
- トークンは Fine-grained で、記事のリポジトリだけに絞り、Contents の読み書きだけを付けてください。期限は 90 日以内を勧めます。
- 表示の制御（管理ボタンの表示など）は利便性のためだけです。実際の権限は GitHub が判定します。
- 本体の Content-Security-Policy は、`csp.html` が返す送り先を含めてください。

## 見た目を変える

記事の書式（ショートコード）の見た目を変えたいときは、本体に同じ名前のファイルを置けば上書きできます（例: `layouts/shortcodes/*.html`）。

## ライセンス

MIT（[LICENSE](LICENSE)）。
