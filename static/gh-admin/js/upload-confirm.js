// 貼り付け・ドロップ・画像ボタンで画像を上げる前の確認。記事のリポジトリは public なので、上げた時点で誰でも見られる。
// 画像の上をドラッグして範囲を選ぶと、切り抜いてから上げられる。ダイアログの中身は textContent と属性だけで作る
import { t } from './i18n.js';

const $ = (id) => document.getElementById(id);
// 切り抜くと劣化・非互換になる形式（GIF はアニメーションが消え、SVG は画像への変換が要る）
const NO_CROP = new Set(['image/gif', 'image/svg+xml']);
// これより小さい範囲は、クリックしただけとみなして選択を取り消す
const MIN_SELECTION = 8;

let original = null;
let current = null;
let previewUrl = '';
// 表示中の画像の上での選択範囲（px）。無ければ null
let selection = null;

function showFile(file) {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(file);
  $('upload-confirm-image').src = previewUrl;
  $('upload-confirm-name').textContent = t('upload.name', { name: file.name || t('upload.pasted_image'), size: Math.max(1, Math.round(file.size / 1024)) });
  clearSelection();
}

function clearSelection() {
  selection = null;
  $('upload-crop-box').hidden = true;
  $('upload-crop-apply').disabled = true;
}

function drawSelection() {
  const box = $('upload-crop-box');
  box.hidden = false;
  box.style.left = `${selection.x}px`;
  box.style.top = `${selection.y}px`;
  box.style.width = `${selection.w}px`;
  box.style.height = `${selection.h}px`;
}

// 選択範囲を元の画像の座標に直して切り抜き、同じ形式（PNG・JPEG・WebP 以外は PNG）の File にする
async function crop() {
  const image = $('upload-confirm-image');
  const scaleX = image.naturalWidth / image.clientWidth;
  const scaleY = image.naturalHeight / image.clientHeight;
  const sx = Math.round(selection.x * scaleX);
  const sy = Math.round(selection.y * scaleY);
  const sw = Math.max(1, Math.round(selection.w * scaleX));
  const sh = Math.max(1, Math.round(selection.h * scaleY));
  const bitmap = await createImageBitmap(current, { imageOrientation: 'from-image' });
  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  canvas.getContext('2d').drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  bitmap.close();
  const type = ['image/png', 'image/jpeg', 'image/webp'].includes(current.type) ? current.type : 'image/png';
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((result) => (result ? resolve(result) : reject(new Error(t('image.convert_failed')))), type, 0.92);
  });
  return new File([blob], current.name || 'image', { type });
}

// 上げてよければ { width: 選んだ表示幅（'' は元のまま）, file: 上げる画像（切り抜いたものを含む） }。やめる・Esc・枠の外なら null
export function confirmImageUpload(file) {
  const dialog = $('upload-confirm');
  original = file;
  current = file;
  showFile(file);
  const croppable = !NO_CROP.has(file.type);
  $('upload-crop-tools').hidden = !croppable;
  $('upload-crop-area').classList.toggle('croppable', croppable);
  $('upload-crop-reset').hidden = true;

  return new Promise((resolve) => {
    const finish = () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = '';
      $('upload-confirm-image').removeAttribute('src');
      resolve(dialog.returnValue === 'upload' ? { width: $('upload-confirm-size').value, file: current } : null);
      original = null;
      current = null;
    };
    dialog.returnValue = '';
    dialog.addEventListener('close', finish, { once: true });
    dialog.showModal();
    $('upload-confirm-ok').focus();
  });
}

function attachCrop() {
  const area = $('upload-crop-area');
  const image = $('upload-confirm-image');
  let start = null;

  // 画像の表示範囲の中に収めた座標
  const point = (event) => {
    const rect = image.getBoundingClientRect();
    return {
      x: Math.min(Math.max(event.clientX - rect.left, 0), rect.width),
      y: Math.min(Math.max(event.clientY - rect.top, 0), rect.height),
    };
  };

  area.addEventListener('pointerdown', (event) => {
    if (!area.classList.contains('croppable') || event.button !== 0) return;
    event.preventDefault();
    area.setPointerCapture(event.pointerId);
    start = point(event);
    selection = { x: start.x, y: start.y, w: 0, h: 0 };
    drawSelection();
  });
  area.addEventListener('pointermove', (event) => {
    if (!start) return;
    const p = point(event);
    selection = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
    drawSelection();
  });
  const end = () => {
    if (!start) return;
    start = null;
    if (!selection || selection.w < MIN_SELECTION || selection.h < MIN_SELECTION) clearSelection();
    else $('upload-crop-apply').disabled = false;
  };
  area.addEventListener('pointerup', end);
  area.addEventListener('pointercancel', end);

  $('upload-crop-apply').addEventListener('click', async () => {
    if (!selection) return;
    try {
      current = await crop();
      showFile(current);
      $('upload-crop-reset').hidden = false;
    } catch (error) {
      $('upload-confirm-name').textContent = error.message;
    }
  });
  $('upload-crop-reset').addEventListener('click', () => {
    current = original;
    showFile(current);
    $('upload-crop-reset').hidden = true;
  });
}

export function attachUploadConfirm() {
  const dialog = $('upload-confirm');
  $('upload-confirm-ok').addEventListener('click', () => dialog.close('upload'));
  $('upload-confirm-cancel').addEventListener('click', () => dialog.close('cancel'));
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close('cancel');
  });
  attachCrop();
}
