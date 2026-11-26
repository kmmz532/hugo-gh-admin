# hugo-gh-admin
Hugoで作成したサイトにGitHubまたはGitLab上のMarkdown記事をブラウザから編集する機能を追加するHugo Modulesのモジュールです。ログイン、記事の新規作成と編集、管理画面などを含みます。

- 保存先はGitHubのリポジトリ、またはGitLabのプロジェクト（gitlab.comとセルフホストのGitLab）。`params.ghAdmin.provider` で選ぶ。記事は `content/posts/<slug>.md` の形で保存します。
- 画面の文言は日本語と英語に対応しています（`params.ghAdmin.lang` で選びます）。英語版の説明は [README.en.md](README.en.md) を参照してください。

## 必要なもの
- Hugo 0.141.0以上（extended）
- Go（Hugo Modulesの取り込みに利用する）
- 記事を置くリポジトリ（以下「記事のリポジトリ」）と、書き込み用のトークン
  - GitHub: Contentsへの読み書き権限を持つFine-grained PAT
  - GitLab: 対象ブランチへプッシュできるロールと `api` スコープを持つアクセストークン

## 取り込み方

本体の `go.mod` と `hugo.toml` に記述する。

```toml
[[module.imports]]
  path = "github.com/kmmz532/hugo-gh-admin"
```

```sh
hugo mod get github.com/kmmz532/hugo-gh-admin@v0.1.0
```

バージョンはタグで固定する。`hugo mod get -u` で更新する前に、差分を確認する。

## 設定（`params.ghAdmin`）

`hugo.toml` の `[params.ghAdmin]` に書きます。省いた項目は既定値になります。既定値は `layouts/partials/gh-admin/settings.html` に1か所だけあります。

| 項目 | 既定値 | 意味 |
|---|---|---|
| `provider` | `github` | 保存先。`github` または `gitlab` |
| `gitlabURL` | `https://gitlab.com` | GitLabのURL。セルフホストのときはインスタンスのURLを書く。`provider = "gitlab"` のときだけ利用する |
| `repo` | なし | 記事のリポジトリ。GitHubは `owner/name`、GitLabはフルパス（`group/subgroup/project`） |
| `branch` | `main` | 記事を保存するブランチ |
| `postsDir` | `content/posts` | 記事を置くフォルダ |
| `pagesDir` | `content` | 固定ページを置くフォルダ |
| `float` | `true` | 浮かせる管理ボタン（`gh-admin/js/float.js`）を表示するか。`false` にすると、差し込んだページでも表示しない |
| `floatGuest` | `true` | ログインしていないときに、浮かせるログインボタンを表示するか |
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
| `siteRepo` | なし | `/admin/settings/` がサイト設定を書き込むサイト本体リポジトリ（書式は `repo` と同じ） |
| `siteBranch` | `main` | サイト本体リポジトリのブランチ |
| `siteConfigPath` | `hugo.toml` | サイト本体リポジトリ内の Hugo 設定ファイル |
| `oauthClientID` | なし | 「GitHubでログイン」に使うGitHub OAuth AppのClient ID。`oauthTokenURL` とあわせて設定すると、ログイン画面にボタンを表示し、トークンの入力は折りたたむ。未設定ならトークンを入力してログインする |
| `oauthTokenURL` | なし | OAuthのコードをトークンに交換するURL（Client Secretを持つサーバーが用意する）。`{"code": "..."}` をPOSTすると `{"access_token": "..."}` を返す |
| `oauthRelayURL` | なし | OAuth Appに登録したコールバックURLが別のサイトにある場合の中継ページ。`state` に戻り先（`r`）と確認用の値（`s`）をJSONにしてBase64URLで渡し、中継ページは戻り先に `code` と `state`（`s` の値）を付けて戻す。未設定ならログイン画面自体をコールバックURLにする |
| `buildWorkflow` | なし | 管理画面の「更新」の「最新バージョンで再ビルド」で実行する、ビルドのワークフローのファイル名（例: `deploy.yml`）。GitLabでは値によらずパイプラインを実行する。未設定なら再ビルドのボタンを出さない |
| `buildCommit` | `false` | `true` にすると、再ビルドで中身が空のコミットを積む（GitHubのみ）。Cloudflare PagesのGit連携など、pushでビルドする構成で使う。`buildWorkflow` より優先する |
| `buildRepo` | `siteRepo`（未設定なら `repo`） | 再ビルドするリポジトリ。記事のリポジトリでビルドする構成などで指定する |
| `buildBranch` | `siteBranch` | 再ビルドするブランチ |
| `tokenProvider` | なし | GitHub のトークンを受け取るモジュールの URL（サイトが用意する）。モジュールは `export async function getGitHubToken()`（GitLabでは `getGitLabToken()`）を持ち、トークン（文字列）か null を返す。トークンはタブを閉じると消える（sessionStorage）。未設定なら PAT でログインする |

画面のURLを変えるときは、本体に同じパスの `content/*.md` を置いて `url:` を上書きし、この項目も同じURLに合わせます。

### 管理画面（`/admin/`）

管理画面は記事・画像・サイト設定を共通のナビゲーションで切り替える。

- `/admin/`：記事の一括管理と固定ページの一覧。固定ページは `/edit/?page=<slug>` で編集し、`/edit/?new=page` で作成する
- `/admin/images/`：画像の管理
- `/admin/update/`：ビルドに使ったモジュールのバージョンと最新バージョンの確認、テーマのバージョンの固定（`moduleversion` の項目）、再ビルド
- `/admin/settings/`：ブログ名・説明・著者・1ページあたりの記事数・言語・ファビコン・記事カード用デフォルトサムネイルと、テーマが定義する項目の設定

サイト設定ではブログ名（`title`・`params.headerTitle`）、ファビコン、デフォルトサムネイルを変更できる。画像は `static/` にアップロードし、`hugo.toml` の設定を更新する。変更は記事の保存先（GitHubまたはGitLab）にコミットされ、サイトの再ビルド後に反映される。

- ブログ名は `title` と `params.headerTitle` に反映する。
- ファビコンは ICO・PNG・SVG、デフォルトサムネイルは PNG・JPEG・WebP・GIF・SVG に対応する。
- デフォルトサムネイルは記事固有の画像がない記事カードだけに適用する。OGP画像には適用しない。
- 説明は `params.description`、著者は `params.author`、1ページあたりの記事数は `pagination.pagerSize`、言語は `languageCode` に反映する。`defaultContentLanguage` があれば、言語コードの先頭（`ja-jp` → `ja`）に合わせて更新する。
- デフォルトサムネイルを解除すると、画像がない記事カードは従来どおり画像なしになる。
- 既存の認証情報でサイト本体リポジトリへの書き込み権限を確認できた場合、トークン入力欄は表示しない。接続できない場合のみ、サイト本体リポジトリの Contents に書き込み可能な PAT を入力する。

サイト本体リポジトリへの書き込み権限を持つトークンが必要で、トークンはこのタブの `sessionStorage` に保存する。GitHubでは Contents に Read and write 権限を持つトークン、GitLabでは対象ブランチへプッシュできる `api` スコープのアクセストークンを利用する。

#### テーマが定義する設定項目

テーマ（またはサイト）の `data/gh-admin/settings.toml` に `[[fields]]` を書くと、サイト設定の「テーマの設定」に入力欄を追加できる。

```toml
[[fields]]
  key = "bio"
  table = "params"
  type = "textarea"
  [fields.label]
    ja = "自己紹介"
    en = "Self-introduction"

[[fields]]
  key = "links"
  table = "params"
  type = "list"
  [fields.label]
    ja = "リンク"
    en = "Links"
  [[fields.columns]]
    key = "name"
    type = "text"
    label = "Name"
  [[fields.columns]]
    key = "url"
    type = "url"
    label = "URL"
```

| キー | 内容 |
|---|---|
| `key` | 変更する設定のキー |
| `table` | キーがあるテーブル（例: `params`）。省略時はファイルの先頭 |
| `type` | `text`・`textarea`・`url`・`number`・`checkbox`・`select`・`list`・`module`・`moduleversion` |
| `label` | 表示名。文字列か、言語ごとの表（`ja`・`en` など） |
| `default` | 設定がないときの値（例: `checkbox` で既定が有効なら `true`） |
| `min`・`max` | `number` の範囲 |
| `options` | `select` の選択肢。`[[fields.options]]` に `value` と `label` を書く |
| `columns` | `list` の列。`[[fields.columns]]` に列ごとの `key`・`type`・`label`（`options`）を書く。`list` は `[[table.key]]` 形式のテーブルの配列として保存する |

`module` は、`[[module.imports]]` のうち `options` の `value` に一致する `path` を切り替える（テーマの切り替えなど）。`moduleversion` は、`go.mod` でモジュールのバージョンを固定するか、ビルドのたびに最新バージョンを利用するかを切り替える。

| キー（`moduleversion`） | 内容 |
|---|---|
| `prefix` | 対象のモジュールのパスの先頭（例: `github.com/kmmz532/blogit/themes/`）。`[[module.imports]]` のうち一致するものを固定する |
| `modules` | ほかに固定するモジュール（例: テーマが取り込む共通部分） |
| `source` | バージョンを取得するGitHubのリポジトリ（`owner/repo`）。固定するときは、このリポジトリの最新コミットから疑似バージョンを作る |
| `branch` | `source` のブランチ。省略時は `main` |
| `file` | `go.mod` のパス。省略時は `go.mod` |

値は文字列・数値・真偽値だけを扱う。変更した項目の行だけを書き換え、ほかの設定やコメントは保持する。

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

## 組み込んでいないテーマで使う

管理画面の部品を呼ばないテーマ（Hugoの一般的なテーマ）でも、次のとおり利用できる。

- `/admin/`・`/edit/`・`/login/` などの管理画面は、hugo-gh-admin の `layouts/gh-admin/baseof.html` で表示する。テーマの `baseof.html` には依存しない。テーマの見た目に合わせる場合は、テーマ側に `layouts/gh-admin/baseof.html` を置いて上書きする。
- 索引は、テーマに `partials/external-meta.html` と `partials/post-url.html` が無い場合、記事のタイトルと `.RelPermalink` を利用する。
- 編集画面のプレビューが読む `lib/marked.min.js` は、hugo-gh-admin の `static/lib/` にある。
- 公開ページへの管理ボタンは、ビルド後のHTMLの `</head>` の前に次の1行を差し込んで表示する。`<meta name="gh-admin">` があるページ（部品を組み込んだテーマ）には差し込まない。

```html
<script type="module" src="/<サイトのパス>/gh-admin/js/float.js"></script>
```

`float.js` は画面の左下にボタンを表示する。ログインしていなければログイン画面への入口だけを、ログインしていれば管理画面へのメニューを表示する。設定は `gh-admin/config/index.json` から読む。ログイン中は索引（`gh-admin/index.json`）も読み、開いているページが記事か固定ページなら「この記事を編集」も表示する。

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

- 管理画面は `/gh-admin/index.json` を読む。1ファイル50件まで、`next` をたどる。項目は `slug`・`title`・`url`・`date`・`external`・`images`・`tags`・`categories`。1つ目のファイルの `pages` には、固定ページ（`slug`・`title`・`url`・`menu`・`noindex`）が入る。`layout` または `type` を持つページ（検索・管理画面など）は含めない。
- 検索用の `/index.json` は本体の担当。

索引は次の 2 つの partial を読むため、テーマはこれを用意する。

- `partials/external-meta.html`: 記事の `title`・`summary`・`image`・`images` を持つ dict を返す。`images` は外部記事の OGP 画像の候補（https のみ）の配列。
- `partials/post-url.html`: 記事の URL を返す。外部記事（`external` あり）なら `external` の値、そうでなければ `.RelPermalink`。

## フロントマター

管理画面が読み書きするのは次の項目だけ。ほかの項目は消さずに残す。

`title`・`date`・`lastmod`・`author`・`categories`・`tags`・`summary`・`image`・`aliases`・`external`・`source`・`build`・`sitemap`・`robots`・`menu`

- 「検索エンジンに表示しない」は `robots: noindex` と `sitemap: {"disable": true}` を書き込む。
- 固定ページのメニューは `menu: {"main": {"weight": 10}}` の形で書き込む。これ以外の書き方の `menu` はそのまま残し、編集画面では変更できない。
- 固定ページの slug には、既存のURLと重なる `admin`・`edit`・`login`・`search`・`archives`・`tags`・`categories`・`posts`・`page`・`images`・`lib`・`gh-admin`・`oauth`・`index` を利用できない。

## 編集履歴

編集画面の「履歴」は、記事ファイルのGitHubのコミット履歴を新しい順に出す。30件ずつ読み込み、「さらに読み込む」で続きを出す。

- 名前の変更（slug の変更）はたどらない。変更後のパスの履歴だけが出る。slug を変えた記事の古いパスの履歴は出ない。
- 保存していない変更（この端末の下書き）は出ない。
- 新規記事はまだファイルが無いため、「まだ保存されていません」と出る。
- 保存の直後はGitHubの一覧への反映が遅れることがあるため、先頭のページが空のときは2秒おきに最大3回取り直す。

## バージョンの約束

- バージョンは [Semantic Versioning](https://semver.org/lang/ja/) に従い、タグで示す（`v0.1.0` など）。
- 次を変えるときはメジャーバージョンを上げ、`CHANGELOG.md` に書く: `params.ghAdmin` の項目、partialの名前と引数、雛形の `id` と `data-field`、CSS変数とクラス名、索引のJSONの形。
- 契約に触れない修正は、マイナーバージョンかパッチバージョンにする。
- リリースのたびに `layouts/partials/gh-admin/version.html` のバージョンを更新する。JSの読み込みに `?v=` として付け、ブラウザのキャッシュに古いJSが残らないようにする。
- タグを付けた直後は、Goのモジュールのプロキシ（proxy.golang.org）が新しいバージョンを認識するまで数分から30分ほどかかる。バージョンを固定していないサイトは、その間にビルドすると古いバージョンのままになる。

## セキュリティ

- Personal Access Tokenはブラウザの `localStorage` に保存される。共有の端末では利用しない。
- GitHubでは、トークンはFine-grainedにし、記事のリポジトリだけに絞ってContentsの読み書きだけを付ける。期限は90日以内にする。
- GitLabでは、トークンは記事のリポジトリのプロジェクトアクセストークンにし、スコープは `api` だけを付ける。期限は90日以内にする。
- 「GitHubでログイン」で受け取るトークンはOAuthの `repo` スコープで、ログインしたアカウントの全リポジトリに書き込める。権限を記事のリポジトリだけに絞りたい場合は、Fine-grainedのトークンでログインする。
- 管理ボタンの表示などは利便性のためだけ。権限はGitHubまたはGitLabが判定する。
- 本体のContent-Security-Policyに、`csp.html` が返す送り先を含める。
- GitLabでは、`connect-src` にGitLabのURL（既定値は `https://gitlab.com`）を含める。また、画像の公開前の表示は `<gitlabURL>/<repo>/-/raw/...` を読み込むため、記事のリポジトリは公開（public）にする。

## 見た目を変える

記事の書式（ショートコード）の見た目を変えるときは、本体に同じ名前のファイルを置く（例: `layouts/shortcodes/*.html`）。上書きされる。

## ライセンス

MIT（[LICENSE](LICENSE)）。
