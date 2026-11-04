// 画像の一覧・アップロード・削除。編集画面の「画像」と /admin/images/ で使う。
// ユーザー由来の文字列は textContent で描画する。GitHub API は github.js 経由。
import { config } from './config.js';
import { listImages, deleteImage } from './github.js';
import { uploadImage, imageSrc } from './image.js';
import { t } from './i18n.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label, iconName, onClick, className = 'btn') {
  const node = el('button', className);
  node.type = 'button';
  const icon = el('i', `fa-solid ${iconName}`);
  icon.setAttribute('aria-hidden', 'true');
  node.append(icon, ` ${label}`);
  node.addEventListener('click', onClick);
  return node;
}

const formatSize = (bytes) => (bytes < 1024 * 100 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`);

// container に UI を作る。onPick を渡すと各画像に「挿入」を、onThumb を渡すと「サムネイル」を出す。onUploaded は 1 枚上げるごとに呼ぶ。
// 返す load() は最初に見せるときに 1 回呼ぶ（API の呼び出しを開くまで遅らせるため）
export function mountImageManager(container, { onPick, onUploaded, onThumb } = {}) {
  const fileInput = el('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.multiple = true;
  fileInput.hidden = true;

  // 挿入・アップロードで本文に入れるときの表示幅（空は元のまま）。alt の末尾の |数字 になる
  const size = el('select');
  size.setAttribute('aria-label', t('images.size_label'));
  for (const [value, label] of [['', t('images.size_original')], ['320', t('images.size_small')], ['480', t('images.size_medium')], ['720', t('images.size_large')]]) {
    size.append(new Option(label, value));
  }

  const status = el('p', 'image-status');
  status.setAttribute('role', 'status');
  const grid = el('div', 'image-grid');
  let items = [];
  let loaded = false;

  const say = (text) => {
    status.textContent = text;
  };

  function tile(item) {
    const card = el('figure', 'image-tile');
    const img = el('img');
    img.src = imageSrc(item.publicPath);
    img.alt = '';
    img.loading = 'lazy';
    img.width = 120;
    img.height = 120;
    const name = el('figcaption', 'image-name', t('images.name_size', { name: item.publicPath.slice(config.imagesURL.length), size: formatSize(item.size) }));

    const actions = el('div', 'image-actions');
    if (onPick) actions.append(button(t('images.insert'), 'fa-plus', () => onPick(item.publicPath, size.value)));
    if (onThumb) actions.append(button(t('images.thumb'), 'fa-image', () => onThumb(item.publicPath)));
    actions.append(
      button('URL', 'fa-copy', async () => {
        try {
          await navigator.clipboard.writeText(item.publicPath);
          say(t('images.copied', { path: item.publicPath }));
        } catch {
          say(item.publicPath);
        }
      }),
      button(
        t('images.delete'),
        'fa-trash',
        async () => {
          if (!confirm(t('images.delete_confirm', { path: item.publicPath }))) return;
          say(t('images.deleting'));
          try {
            await deleteImage(item.path, item.sha);
            items = items.filter((other) => other !== item);
            render();
            say(t('images.deleted'));
          } catch (error) {
            say(error.message);
          }
        },
        'btn danger',
      ),
    );
    card.append(img, name, actions);
    return card;
  }

  function render() {
    grid.replaceChildren(...items.map(tile));
    if (loaded && !items.length) grid.textContent = t('images.empty');
  }

  async function load() {
    say(t('images.loading'));
    try {
      items = await listImages();
      loaded = true;
      render();
      say(t('images.count', { count: items.length }));
    } catch (error) {
      say(error.message);
    }
  }

  async function upload(files) {
    const images = [...files].filter((file) => file.type.startsWith('image/'));
    if (!images.length) return;
    let done = 0;
    for (const file of images) {
      say(t('images.uploading', { done: done + 1, total: images.length }));
      try {
        const url = await uploadImage(file);
        onUploaded?.(url, file, size.value);
        done += 1;
      } catch (error) {
        say(`${file.name}: ${error.message}`);
        if (done) await load();
        return;
      }
    }
    await load();
    say(t('images.uploaded', { done }));
  }

  fileInput.addEventListener('change', () => {
    const files = [...fileInput.files];
    fileInput.value = '';
    upload(files);
  });
  container.addEventListener('dragover', (event) => {
    if (![...(event.dataTransfer?.items ?? [])].some((item) => item.kind === 'file')) return;
    event.preventDefault();
    container.classList.add('dragover');
  });
  container.addEventListener('dragleave', () => container.classList.remove('dragover'));
  container.addEventListener('drop', (event) => {
    container.classList.remove('dragover');
    if (!event.dataTransfer?.files.length) return;
    event.preventDefault();
    upload(event.dataTransfer.files);
  });

  const bar = el('div', 'image-bar');
  bar.append(
    button(t('images.upload'), 'fa-upload', () => fileInput.click(), 'btn primary'),
    button(t('images.reload'), 'fa-rotate', load),
  );
  if (onPick || onUploaded) {
    const label = el('label', 'image-size', t('images.size_for_body'));
    label.append(size);
    bar.append(label);
  }
  container.append(bar, fileInput, status, grid);
  return { load };
}
