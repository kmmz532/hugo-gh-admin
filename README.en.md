# hugo-gh-admin

A Hugo Module that adds a browser-based editor for the Markdown posts on GitHub or GitLab to a Hugo site. It includes login, creating and editing posts, and the admin screens. (Japanese version: [README.md](README.md))

- Posts are saved to a GitHub repository or a GitLab project (gitlab.com or a self-managed instance), chosen with `params.ghAdmin.provider`, as `content/posts/<slug>.md`.
- The admin screens are available in Japanese and English. Choose the language with `params.ghAdmin.lang`.

## Requirements

- Hugo 0.141.0 or later (extended edition)
- Go (used by Hugo Modules to fetch the module)
- A repository for the posts (called "the posts repository" below) and a token that can write to it
  - GitHub: a fine-grained PAT with read and write access to its Contents
  - GitLab: an access token with the `api` scope and a role that can push to its target branch

## Installation

Add the following to the site's `go.mod` and `hugo.toml`.

```toml
[[module.imports]]
  path = "github.com/kmmz532/hugo-gh-admin"
```

```sh
hugo mod get github.com/kmmz532/hugo-gh-admin@v0.1.0
```

Pin the version with a tag. Check the differences before running `hugo mod get -u`.

## Settings (`params.ghAdmin`)

Write these in `[params.ghAdmin]` in `hugo.toml`. Omitted items use their defaults. The defaults are defined only once, in `layouts/partials/gh-admin/settings.html`.

| Item | Default | Meaning |
|---|---|---|
| `provider` | `github` | Where posts are saved: `github` or `gitlab` |
| `gitlabURL` | `https://gitlab.com` | The GitLab URL. Set the instance URL for a self-managed GitLab. Used only with `provider = "gitlab"` |
| `repo` | none | The posts repository: `owner/name` on GitHub, or the full path (`group/subgroup/project`) on GitLab |
| `branch` | `main` | The branch where posts are saved |
| `postsDir` | `content/posts` | The folder for posts |
| `imagesDir` | `static/images` | The folder for images |
| `imagesURL` | `/images/` | The URL prefix for images in posts (passed through `relURL`) |
| `defaultCategory` | `tech` | The default category for new posts |
| `authorField` | `false` | With `true`, the editor shows an author field. Otherwise, the `author` in a post is kept as it is |
| `author` | (empty) | The default author for new posts (a GitHub username). The author saved last in the editor takes priority |
| `editURL` | `/edit/` | The URL of the editor |
| `loginURL` | `/login/` | The URL of the login screen |
| `adminURL` | `/admin/` | The URL of bulk management |
| `adminImagesURL` | `/admin/images/` | The URL of image management |
| `postURL` | `/posts/{slug}/` | The URL pattern for posts. Replaces `{slug}` (file name), `{name}` (name without the leading date), `{yyyy}`, `{mm}` and `{dd}`. Used by the pending display |
| `lang` | the first part of `languageCode` (`en-us` → `en`) | The language of the admin screens. Falls back to `en` when there is no dictionary. Dictionaries are in `data/gh-admin/i18n/<lang>.toml` |
| `siteRepo` | none | The site repository (same format as `repo`) where `/admin/settings/` writes the site settings |
| `siteBranch` | `main` | The branch of the site repository |
| `siteConfigPath` | `hugo.toml` | The Hugo configuration file in the site repository |
| `oauthClientID` | none | The Client ID of a GitHub OAuth App for "Log in with GitHub". With `oauthTokenURL`, the login page shows the button and folds the token field. Without it, you log in with a token |
| `oauthTokenURL` | none | A URL that exchanges the OAuth code for a token (provided by a server that holds the Client Secret). POST `{"code": "..."}` and it returns `{"access_token": "..."}` |
| `oauthRelayURL` | none | A relay page when the callback URL registered in the OAuth App is on another site. `state` carries JSON with the return URL (`r`) and a check value (`s`) in Base64URL, and the relay page returns to `r` with `code` and `state` (the value of `s`). Without it, the login page itself is the callback URL |
| `tokenProvider` | none | The URL of a module that provides the GitHub token (provided by the site). The module exports `async function getGitHubToken()` (`getGitLabToken()` on GitLab) and returns a token string or null. The token is cleared when the tab closes (sessionStorage). Without it, you log in with a PAT |

To change the URLs of the admin screens, put a `content/*.md` with the same path in the site, override `url:`, and set the same URL in these items.

```toml
[params.ghAdmin]
  repo = "owner/articles"
  branch = "main"
```

### Admin screens (`/admin/`)

The admin screens switch between posts, images and site settings with a shared navigation.

- `/admin/`: bulk management of posts
- `/admin/images/`: image management
- `/admin/settings/`: the blog name, description, author, posts per page, language, favicon, default thumbnail for post cards, and settings defined by the theme

The site settings change the blog name (`title` and `params.headerTitle`), the favicon and the default thumbnail. Images are uploaded to `static/`, and the settings in `hugo.toml` are updated. Changes are committed to GitHub or GitLab and take effect after the site is rebuilt.

- The blog name is written to `title` and `params.headerTitle`.
- The favicon accepts ICO, PNG and SVG. The default thumbnail accepts PNG, JPEG, WebP, GIF and SVG.
- The default thumbnail applies only to post cards without their own image. It does not apply to OGP images.
- When the default thumbnail is removed, post cards without an image are shown without one, as before.
- If the existing credentials can write to the site repository, the token field is hidden. Only when they cannot, enter a PAT with Contents write access to the site repository.
- The description is written to `params.description`, the author to `params.author`, posts per page to `pagination.pagerSize` and the language to `languageCode`. If `defaultContentLanguage` exists, it is updated to the first part of the language code (`ja-jp` → `ja`).

#### Settings defined by the theme

A theme (or the site) can add fields to "Theme settings" by writing `[[fields]]` in `data/gh-admin/settings.toml`. Each field has `key`, `table` (for example `params`; the top of the file if omitted), `type` (`text`, `textarea`, `url`, `number`, `checkbox`, `select`, `list`, `module` or `moduleversion`), `label` (a string or a table per language), and optionally `default`, `min`, `max`, `options` (`[[fields.options]]` with `value` and `label`) and `columns` (`[[fields.columns]]` for `list`, saved as an array of tables `[[table.key]]`). `module` switches the `path` of the `[[module.imports]]` entry that matches one of the `options` (for example, to switch themes). `moduleversion` switches between pinning module versions in `go.mod` and using the latest version on every build; it takes `prefix`, `modules`, `source` (a GitHub `owner/repo` whose latest commit becomes the pseudo-version), `branch` and `file`. See the Japanese README for examples.

Only strings, numbers and booleans are supported. Only the lines of changed settings are rewritten, and other settings and comments are kept.

A token that can write to the site repository is required: on GitHub, a token with Contents read and write access; on GitLab, an access token with the `api` scope that can push to the target branch. The token is stored in this tab's `sessionStorage`.

### Overriding messages

The admin messages are in `data/gh-admin/i18n/<lang>.toml`. Keys are two levels, `<screen>.<item>` (for example `editor.publish`).

- A file with the same path in the site (`data/gh-admin/i18n/<lang>.toml`) takes priority over the module's file. The override is per file, so if you change only some keys, write all the keys of that file.
- In a string, `{name}` is replaced with the value. Keep the same names when you rewrite a message.
- The `<title>` of an admin page comes from `title:` in `content/*.md`. The module's default is a generic English name (for example `Admin`). To change it, put a `content/*.md` with the same path in the site and write `title:` there.

## Integration with the site (theme)

The site calls only these partials.

| Partial | Where it is called | Arguments | Role |
|---|---|---|---|
| `gh-admin/head.html` | `<head>` (after the CSS bundle) | `.` | `<meta name="gh-admin">`, the editor CSS, `admin.js` |
| `gh-admin/csp.html` | Where the CSP `script-src` is built | `.` | Extra sources for that page (cdnjs on the editor only) |
| `gh-admin/button.html` | Header, post cards, footer | `dict "kind" "edit\|new\|admin\|login\|logout\|footer" "page" . "class" "..." "label" "..." "text" true` | Entry buttons to the admin screens |
| `gh-admin/article-scripts.html` | The `scripts` block of a post | `.` | Loads the copy button for code blocks |

`csp.html` returns the values to add to `script-src`. It puts a leading space and outputs no trailing newline.

## What the theme provides (contract)

### Pending templates

Output `<template id="gh-admin-pending-card">` (for list cards) and `<template id="gh-admin-pending-article">` (for a post page) in the page's `<body>`. `pending.js` clones the templates and fills these elements.

- `data-field="thumb|band|date|categories|title|external|source|summary|tags|edit|crumbs|body"`: the elements that receive values. Only `textContent`, `src` and `href` are used.
- `data-item="tag|crumb"`: nested templates cloned once per item.
- Insertion points: `[data-pending-target="list"]` for the list, and `[data-pending-target="article"]` (the 404 box) or `article[data-slug]` for a post.

`data-field="edit"` in the post template is optional. If present, its `href` is set to the editor URL.

On pages without the templates, only the pending band is shown.

### Class names and CSS variables

- Headings use `.page-title`, post headings use `.post-title`, and the body uses `.post-body`. The preview uses the same classes.
- The editor CSS (`assets/gh-admin/editor.css`) uses these CSS variables, which the theme must define:
  `--text-primary`, `--text-secondary`, `--foreground`, `--foreground-rgb`, `--background`, `--border`, `--link`, `--danger`
- The math in the editor preview loads `lib/marked.min.js` (in the site's `static/lib/`).

### Index

- The admin screens read `/gh-admin/index.json`. It holds up to 50 items per file and follows `next`. Items have `slug`, `title`, `url`, `date`, `external`, `images`, `tags` and `categories`.
- The search index `/index.json` is handled by the site.

The theme must provide these two partials, which the index uses.

- `partials/external-meta.html`: returns a dict with `title`, `summary`, `image` and `images` of a post. `images` is an array of OGP image candidates for external links (https only).
- `partials/post-url.html`: returns the URL of a post. For an external link (with `external`), it returns the `external` value; otherwise `.RelPermalink`.

## Front matter

The admin screens read and write only these items. Other items are kept as they are.

`title`, `date`, `lastmod`, `author`, `categories`, `tags`, `summary`, `image`, `aliases`, `external`, `source`, `build`, `sitemap`

## Edit history

The "History" section in the editor lists the commit history of the post file on GitHub, newest first. It loads 30 items at a time; "Load more" shows the next ones.

- Renames (slug changes) are not followed. Only the history of the new path is shown. The history of the old path is not shown.
- Unsaved changes (drafts on this device) are not shown.
- A new post has no file yet, so the section shows "Not saved yet".

## Versioning

- Versions follow [Semantic Versioning](https://semver.org/) and are marked with tags (for example `v0.1.0`).
- A change to any of the following needs a major version and an entry in `CHANGELOG.md`: items in `params.ghAdmin`, the names and arguments of partials, the `id` and `data-field` of the templates, CSS variables and class names, and the shape of the index JSON.
- Fixes that do not touch the contract are minor or patch versions.
- Update the version in `layouts/partials/gh-admin/version.html` on every release. It is added to the script URLs as `?v=` so browsers do not keep old JS in their cache.
- Right after a tag, the Go module proxy (proxy.golang.org) can take a few minutes to about 30 minutes to see the new version. Sites that do not pin the version keep building with the old one until then.

## Security

- The Personal Access Token is stored in the browser's `localStorage`. Do not use it on shared devices.
- On GitHub, use a fine-grained token limited to the posts repository, with only Contents read and write. The expiry must be 90 days or less.
- On GitLab, use a project access token for the posts repository with only the `api` scope. The expiry must be 90 days or less.
- The token from "Log in with GitHub" has the OAuth `repo` scope and can write to every repository of the account. To limit it to the posts repository, log in with a fine-grained token instead.
- Showing the admin buttons is only for convenience. GitHub or GitLab decides the permissions.
- The site's Content-Security-Policy must include the sources that `csp.html` returns.
- On GitLab, include the GitLab URL (default `https://gitlab.com`) in `connect-src`. The editor shows unpublished images from `<gitlabURL>/<repo>/-/raw/...`, so the posts repository must be public.

## Changing the look

To change how a shortcode in a post looks, put a file with the same name in the site (for example `layouts/shortcodes/*.html`). It overrides the module's file.

## License

MIT ([LICENSE](LICENSE)).
