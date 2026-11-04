# hugo-gh-admin
Hugoで作成したサイトにGitHub上のMarkdown記事をブラウザから編集する機能を追加するHugo Modulesのモジュールです。ログイン、記事の新規作成と編集、管理画面などを含みます。

- 保存先はGitHubリポジトリ。記事は `content/posts/<slug>.md` の形で保存します。
- 画面の文言は日本語と英語に対応しています（`params.ghAdmin.lang` で選びます）。英語版の説明は [README.en.md](README.en.md) を参照してください。

## 必要なもの
- Hugo 0.141.0以上のextended版
- Go（Hugo Modulesの取り込みに利用する）
- 記事を置くGitHubリポジトリ（以下「記事のリポジトリ」）と、そのContentsへの読み書き権限を持つGitHub PAT

## 取り込み方

本体の `go.mod` と `hugo.toml` に記述する。

```toml
[[module.imports]]
  path = "github.com/kmmz532/hugo-gh-admin"
```

```sh
hugo mod get github.com/kmmz532/hugo-gh-admin@v0.1.0
```

版はタグで固定する。`hugo mod get -u` で更新する前に、差分を確認する。

## 設定（`params.ghAdmin`）

`hugo.toml` の `[params.ghAdmin]` に書きます。省いた項目は既定値になります。既定値は `layouts/partials/gh-admin/settings.html` に1か所だけあります。

| 項目 | 既定値 | 意味 |
|---|---|---|
| `repo` | なし | 記事のリポジトリ（`owner/name`） |
| `branch` | `main` | 記事を保存するブランチ |
| `postsDir` | `content/posts` | 記事を置くフォルダ |
| `imagesDir` | `static/images` | 画像を置くフォルダ |
| `imagesURL` | `/images/` | 記事に書く画像のURLの前置き（`relURL` を通す） |
| `defaultCategory` | `tech` | 新規記事の既定のカテゴリ |
| `authorField` | `false` | `true` にすると、編集画面に作者の欄を出す。出さないサイトでは、記事の `author` をそのまま保持する |
| `author` | （空） | 新規記事の既定の作者（GitHub のユーザー名）。編集画面で最後に保存した作者があれば、そちらを優先する |
| `editURL` | `/edit/` | 編集画面のURL |
| `loginURL` | `/login/` | ログイン画面のURL |
| `adminURL` | `/admin/` | 一括管理のURL |
| `adminImagesURL` | `/admin/images/` | 画像の管理のURL |
| `postURL` | `/posts/{slug}/` | 記事のURLの形。`{slug}`（ファイル名）・`{name}`（先頭の日付を除いた名前）・`{yyyy}`・`{mm}`・`{dd}` を置き換える。反映待ちの表示で利用する |
| `lang` | `languageCode` の先頭（`ja-jp` → `ja`） | 管理画面の文言の言語。辞書が無ければ `en`。辞書は `data/gh-admin/i18n/<lang>.toml` |
| `tokenProvider` | なし | GitHub のトークンを受け取るモジュールの URL（サイトが用意する）。モジュールは `export async function getGitHubToken()` を持ち、トークン（文字列）か null を返す。トークンはタブを閉じると消える（sessionStorage）。未設定なら PAT でログインする |

画面のURLを変えるときは、本体に同じパスの `content/*.md` を置いて `url:` を上書きし、この項目も同じURLに合わせます。

```toml
[params.ghAdmin]
  repo = "owner/articles"
  branch = "main"
```

### 文言の上書き

管理画面の文言は `data/gh-admin/i18n/<lang>.toml` にある。キーは `<画面>.<項目>` の 2 階層（例: `editor.publish`）。

- 本体の `data/gh-admin/i18n/<lang>.toml` を置くと、モジュールのファイルより本体が優先される。ファイル単位で置き換わるため、一部のキーだけを変えるときも、そのファイルの全キーを書く。
- 文字列の `{name}` は差し込みの値に置き換わる。書き換えるときも同じ名前を残す。
- 管理画面のページ名（ブラウザのタブの `<title>`）は `content/*.md` の `title:` で決まる。モジュールの既定値は英語（`Admin` など）。日本語にするときは、本体に同じパスの `content/*.md` を置いて `title:` を書く（例: `content/admin.md` の `title: "一括管理"`）。

## 本体（テーマ）との接点

本体は次のpartialだけを呼びます。

| partial | 呼ぶ場所 | 引数 | 役目 |
|---|---|---|---|
| `gh-admin/head.html` | `<head>`（CSSのbundleの後） | `.` | `<meta name="gh-admin">`、編集画面のCSS、`admin.js` |
| `gh-admin/csp.html` | CSPの `script-src` を組むところ | `.` | そのページで足す送り先（編集画面だけcdnjs） |
| `gh-admin/button.html` | ヘッダー・記事カード・フッター | `dict "kind" "edit\|new\|admin\|login\|logout\|footer" "page" . "class" "..." "label" "..." "text" true` | 管理画面への入口のボタン |
| `gh-admin/article-scripts.html` | 記事詳細の `scripts` ブロック | `.` | コードのコピーボタンの読み込み |

`csp.html` は `script-src` に足す値を返します。前に空白を付け、末尾に改行を出しません。

## テーマが用意するもの（契約）

### 反映待ちの雛形

`<template id="gh-admin-pending-card">`（一覧のカード）と `<template id="gh-admin-pending-article">`（記事詳細）を、ページの `<body>` に出します。`pending.js` は雛形を複製し、次の要素に値を入れます。

- `data-field="thumb|band|date|categories|title|external|source|summary|tags|edit|crumbs|body"`: 値を入れる要素。`textContent`・`src`・`href` だけを利用する。
- `data-item="tag|crumb"`: 項目の数だけ複製される入れ子の雛形。
- 差し込み先: 一覧は `[data-pending-target="list"]`、記事は `[data-pending-target="article"]`（404の箱）か `article[data-slug]`。

記事の雛形の `data-field="edit"` は任意。置くと、その要素に編集画面へのURL（`href`）を入れる。

雛形がないページでは、反映待ちの帯だけを出します。

### クラス名とCSS変数

- 見出しは `.page-title`、記事の見出しは `.post-title`、本文は `.post-body`。プレビューも同じクラスを利用する。
- 編集画面のCSS（`assets/gh-admin/editor.css`）は次のCSS変数を利用する。本体のテーマで定義する。
  `--text-primary`・`--text-secondary`・`--foreground`・`--foreground-rgb`・`--background`・`--border`・`--link`・`--danger`
- 編集画面のプレビューの数式は `lib/marked.min.js`（本体の `static/lib/`）を読む。

### 索引

- 管理画面は `/gh-admin/index.json` を読む。1ファイル50件まで、`next` をたどる。項目は `slug`・`title`・`url`・`date`・`external`・`images`・`tags`・`categories`。
- 検索用の `/index.json` は本体の担当。

索引は次の 2 つの partial を読むため、テーマはこれを用意する。

- `partials/external-meta.html`: 記事の `title`・`summary`・`image`・`images` を持つ dict を返す。`images` は外部記事の OGP 画像の候補（https のみ）の配列。
- `partials/post-url.html`: 記事の URL を返す。外部記事（`external` あり）なら `external` の値、そうでなければ `.RelPermalink`。

## フロントマター

管理画面が読み書きするのは次の項目だけ。ほかの項目は消さずに残す。

`title`・`date`・`lastmod`・`author`・`categories`・`tags`・`summary`・`image`・`aliases`・`external`・`source`・`build`・`sitemap`

## 編集履歴

編集画面の「履歴」は、記事ファイルのGitHubのコミット履歴を新しい順に出す。30件ずつ読み込み、「さらに読み込む」で続きを出す。

- 名前の変更（slug の変更）はたどらない。変更後のパスの履歴だけが出る。slug を変えた記事の古いパスの履歴は出ない。
- 保存していない変更（この端末の下書き）は出ない。
- 新規記事はまだファイルが無いため、「まだ保存されていません」と出る。

## 版の約束

- 版は [Semantic Versioning](https://semver.org/lang/ja/) に従い、タグで示す（`v0.1.0` など）。
- 次を変えるときはメジャー版を上げ、`CHANGELOG.md` に書く: `params.ghAdmin` の項目、partialの名前と引数、雛形の `id` と `data-field`、CSS変数とクラス名、索引のJSONの形。
- 契約に触れない修正は、マイナー版かパッチ版にする。

## セキュリティ

- Personal Access Tokenはブラウザの `localStorage` に保存される。共有の端末では利用しない。
- トークンはFine-grainedにし、記事のリポジトリだけに絞ってContentsの読み書きだけを付ける。期限は90日以内にする。
- 管理ボタンの表示などは利便性のためだけ。権限はGitHubが判定する。
- 本体のContent-Security-Policyに、`csp.html` が返す送り先を含める。

## 見た目を変える

記事の書式（ショートコード）の見た目を変えるときは、本体に同じ名前のファイルを置く（例: `layouts/shortcodes/*.html`）。上書きされる。

## ライセンス

MIT（[LICENSE](LICENSE)）。
