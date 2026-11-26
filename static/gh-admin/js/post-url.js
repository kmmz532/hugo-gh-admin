// 記事の URL（設定 postURL）から記事のファイル名（slug）を取り出す。設定（config.js）を読まないので、float.js からも使える。
// postURL は {slug}（ファイル名）・{name}（先頭の日付を除いた名前）・{yyyy}・{mm}・{dd} を含む形。
// rootURL を除いた部分が postURL の形に合わなければ null
export function slugFromPostPath(pathname, rootURL, postURL) {
  const root = rootURL.replace(/\/$/, '');
  if (!pathname.startsWith(root)) return null;
  const keys = [];
  const source = postURL
    .split(/(\{(?:slug|name|yyyy|mm|dd)\})/)
    .map((part) => {
      const key = /^\{(\w+)\}$/.exec(part)?.[1];
      if (!key) return part.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
      keys.push(key);
      return key === 'slug' || key === 'name' ? '([a-z0-9-]+)' : '(\\d+)';
    })
    .join('')
    .replace(/\\\/$/, '\\/?');
  const m = new RegExp(`^${source}$`).exec(pathname.slice(root.length));
  if (!m) return null;
  const v = Object.fromEntries(keys.map((k, i) => [k, m[i + 1]]));
  if (v.slug) return v.slug;
  if (v.name && v.yyyy && v.mm && v.dd) return `${v.yyyy}-${v.mm}-${v.dd}-${v.name}`;
  return v.name ?? null;
}
