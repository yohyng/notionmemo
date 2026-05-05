const STORAGE_KEY = 'instant_memo_settings_v2';
const QUEUE_KEY = 'instant_memo_queue_v2';
const CACHE_KEY = 'instant_memo_recent_cache_v2';

const $ = (id) => document.getElementById(id);

const els = {
  memo: $('memoInput'),
  url: $('urlInput'),
  tags: $('tagsInput'),
  category: $('categoryInput'),
  device: $('deviceInput'),
  endpoint: $('endpointInput'),
  secret: $('secretInput'),
  settingsPanel: $('settingsPanel'),
  settingsToggle: $('settingsToggle'),
  saveSettings: $('saveSettingsButton'),
  send: $('sendButton'),
  refresh: $('refreshButton'),
  flushQueue: $('flushQueueButton'),
  statusDot: $('statusDot'),
  statusText: $('statusText'),
  queueBadge: $('queueBadge'),
  memoList: $('memoList'),
  editDialog: $('editDialog'),
  closeEdit: $('closeEditButton'),
  editMemo: $('editMemoInput'),
  editUrl: $('editUrlInput'),
  editTags: $('editTagsInput'),
  editCategory: $('editCategoryInput'),
  editMeta: $('editMeta'),
  update: $('updateButton'),
  duplicate: $('duplicateButton'),
  trash: $('trashButton'),
};

let currentEditingMemo = null;

init();

function init() {
  runSelfTests();
  loadSettings();
  renderQueueBadge();
  registerServiceWorker();
  renderCachedList();

  requestAnimationFrame(() => els.memo.focus());

  els.settingsToggle.addEventListener('click', () => {
    els.settingsPanel.classList.toggle('hidden');
  });

  els.saveSettings.addEventListener('click', () => {
    saveSettings();
    setStatus('設定を保存しました', 'success');
    els.memo.focus();
  });

  els.send.addEventListener('click', createMemo);
  els.refresh.addEventListener('click', refreshList);
  els.flushQueue.addEventListener('click', flushQueue);

  els.closeEdit.addEventListener('click', closeEditDialog);
  els.update.addEventListener('click', updateMemo);
  els.duplicate.addEventListener('click', duplicateMemo);
  els.trash.addEventListener('click', trashMemo);

  els.memo.addEventListener('keydown', (event) => {
    const isSubmit = (event.ctrlKey || event.metaKey) && event.key === 'Enter';
    if (isSubmit) {
      event.preventDefault();
      createMemo();
    }
  });

  window.addEventListener('online', () => {
    setStatus('オンラインに復帰しました', 'success');
    flushQueue();
    refreshList();
  });

  refreshList({ silent: true });
}

async function createMemo() {
  const settings = getSettings();
  const memo = els.memo.value.trim();

  if (!memo) {
    setStatus('メモが空です', 'error');
    return;
  }

  if (!settings.endpoint || !settings.secret) {
    setStatus('GAS EndpointとApp Secretを設定してください', 'error');
    els.settingsPanel.classList.remove('hidden');
    return;
  }

  saveSettings();

  const payload = {
    action: 'create',
    clientId: createUuid(),
    memo,
    url: els.url.value.trim(),
    tags: splitTags(els.tags.value),
    category: els.category.value.trim(),
    device: els.device.value.trim(),
    date: new Date().toISOString(),
  };

  setStatus('送信中...', 'sending');

  const res = await callApi(payload);

  if (res.ok) {
    els.memo.value = '';
    els.url.value = '';
    setStatus('Notion DBに保存しました', 'success');
    await refreshList({ silent: true });
    els.memo.focus();
    return;
  }

  enqueue(payload);
  setStatus('送信失敗。未送信キューに保存しました', 'error');
  renderQueueBadge();
}

async function refreshList(options = {}) {
  const { silent = false } = options;
  const settings = getSettings();

  if (!settings.endpoint || !settings.secret) {
    if (!silent) setStatus('GAS EndpointとApp Secretを設定してください', 'error');
    return;
  }

  if (!silent) setStatus('Notion DBを取得中...', 'sending');

  const res = await callApi({ action: 'list', limit: 30 });

  if (!res.ok) {
    if (!silent) setStatus('取得に失敗しました', 'error');
    return;
  }

  const items = Array.isArray(res.items) ? res.items : [];
  localStorage.setItem(CACHE_KEY, JSON.stringify(items));
  renderList(items);

  if (!silent) setStatus('最新メモを取得しました', 'success');
}

function renderCachedList() {
  try {
    const items = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]');
    renderList(items);
  } catch {
    renderList([]);
  }
}

function renderList(items) {
  if (!items.length) {
    els.memoList.innerHTML = '<div class="empty-state">まだメモがありません</div>';
    return;
  }

  els.memoList.innerHTML = items.map((item) => {
    const title = escapeHtml(item.title || makeTitle(item.memo || ''));
    const memo = escapeHtml(item.memo || '');
    const date = escapeHtml(formatDate(item.date || item.createdTime || item.lastEditedTime || ''));
    const category = escapeHtml(item.category || 'Memo');
    const tags = Array.isArray(item.tags) ? item.tags : [];

    return `
      <button class="memo-item" type="button" data-page-id="${escapeHtml(item.pageId)}">
        <h3 class="memo-title">${title}</h3>
        <p class="memo-body">${memo}</p>
        <div class="memo-meta">
          <span>${date}</span>
          <span class="memo-category">${category}</span>
        </div>
        <div class="memo-tags">
          ${tags.map((tag) => `<span class="memo-tag">#${escapeHtml(tag)}</span>`).join('')}
        </div>
      </button>
    `;
  }).join('');

  els.memoList.querySelectorAll('.memo-item').forEach((button) => {
    button.addEventListener('click', () => openMemo(button.dataset.pageId));
  });
}

async function openMemo(pageId) {
  const res = await callApi({ action: 'get', pageId });

  if (!res.ok || !res.item) {
    setStatus('メモの取得に失敗しました', 'error');
    return;
  }

  currentEditingMemo = res.item;
  els.editMemo.value = res.item.memo || '';
  els.editUrl.value = res.item.url || '';
  els.editTags.value = Array.isArray(res.item.tags) ? res.item.tags.join(', ') : '';
  els.editCategory.value = res.item.category || '';
  els.editMeta.textContent = `page_id: ${res.item.pageId} / last_edited_time: ${res.item.lastEditedTime || '-'}`;
  els.editDialog.showModal();
}

function closeEditDialog() {
  els.editDialog.close();
  currentEditingMemo = null;
}

async function updateMemo() {
  if (!currentEditingMemo) return;

  const payload = {
    action: 'update',
    pageId: currentEditingMemo.pageId,
    expectedLastEditedTime: currentEditingMemo.lastEditedTime,
    memo: els.editMemo.value.trim(),
    url: els.editUrl.value.trim(),
    tags: splitTags(els.editTags.value),
    category: els.editCategory.value.trim(),
    device: els.device.value.trim(),
    date: currentEditingMemo.date || new Date().toISOString(),
  };

  if (!payload.memo) {
    setStatus('メモが空です', 'error');
    return;
  }

  setStatus('更新中...', 'sending');
  const res = await callApi(payload);

  if (res.ok) {
    setStatus('更新しました', 'success');
    closeEditDialog();
    await refreshList({ silent: true });
    return;
  }

  if (res.conflict) {
    const saveAsNew = window.confirm('他のデバイスで更新されています。上書きせず、別メモとして保存しますか？');
    if (saveAsNew) {
      await duplicateMemo();
    } else {
      setStatus('更新をキャンセルしました', 'error');
    }
    return;
  }

  setStatus('更新に失敗しました', 'error');
}

async function duplicateMemo() {
  const payload = {
    action: 'create',
    clientId: createUuid(),
    memo: els.editMemo.value.trim(),
    url: els.editUrl.value.trim(),
    tags: splitTags(els.editTags.value),
    category: els.editCategory.value.trim(),
    device: els.device.value.trim(),
    date: new Date().toISOString(),
  };

  if (!payload.memo) {
    setStatus('メモが空です', 'error');
    return;
  }

  setStatus('別メモとして保存中...', 'sending');
  const res = await callApi(payload);

  if (res.ok) {
    setStatus('別メモとして保存しました', 'success');
    closeEditDialog();
    await refreshList({ silent: true });
    return;
  }

  enqueue(payload);
  setStatus('保存失敗。未送信キューに保存しました', 'error');
  renderQueueBadge();
}

async function trashMemo() {
  if (!currentEditingMemo) return;

  const confirmed = window.confirm('このメモをNotionのゴミ箱へ移動しますか？');
  if (!confirmed) return;

  setStatus('削除中...', 'sending');
  const res = await callApi({
    action: 'trash',
    pageId: currentEditingMemo.pageId,
    expectedLastEditedTime: currentEditingMemo.lastEditedTime,
  });

  if (res.ok) {
    setStatus('ゴミ箱へ移動しました', 'success');
    closeEditDialog();
    await refreshList({ silent: true });
    return;
  }

  if (res.conflict) {
    setStatus('他のデバイスで更新されています。再取得してください', 'error');
    return;
  }

  setStatus('削除に失敗しました', 'error');
}

async function flushQueue() {
  const queue = getQueue();

  if (!queue.length) {
    setStatus('未送信メモはありません', 'idle');
    return;
  }

  setStatus(`未送信 ${queue.length} 件を再送中...`, 'sending');

  const rest = [];
  for (const item of queue) {
    const res = await callApi(item);
    if (!res.ok) rest.push(item);
  }

  localStorage.setItem(QUEUE_KEY, JSON.stringify(rest));
  renderQueueBadge();

  if (rest.length === 0) {
    setStatus('未送信メモをすべて保存しました', 'success');
    await refreshList({ silent: true });
  } else {
    setStatus(`${rest.length} 件が未送信です`, 'error');
  }
}

async function callApi(payload) {
  const settings = getSettings();
  const endpoint = settings.endpoint;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
      },
      body: JSON.stringify({
        secret: settings.secret,
        ...payload,
      }),
    });

    return await response.json();
  } catch (error) {
    console.warn('callApi failed', error);
    return { ok: false, error: String(error) };
  }
}

function enqueue(payload) {
  const queue = getQueue();
  queue.push(payload);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

function getQueue() {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
}

function renderQueueBadge() {
  const count = getQueue().length;
  els.queueBadge.textContent = String(count);
  els.queueBadge.classList.toggle('hidden', count === 0);
}

function setStatus(text, state = 'idle') {
  els.statusText.textContent = text;
  els.statusDot.className = `status-dot ${state}`;
}

function getSettings() {
  return {
    endpoint: els.endpoint.value.trim(),
    secret: els.secret.value.trim(),
    tags: els.tags.value.trim(),
    category: els.category.value.trim(),
    device: els.device.value.trim(),
  };
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(getSettings()));
}

function loadSettings() {
  const defaultDevice = guessDeviceName();

  try {
    const settings = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    els.endpoint.value = settings.endpoint || '';
    els.secret.value = settings.secret || '';
    els.tags.value = settings.tags || 'idea, memo';
    els.category.value = settings.category || 'Memo';
    els.device.value = settings.device || defaultDevice;
  } catch {
    els.tags.value = 'idea, memo';
    els.category.value = 'Memo';
    els.device.value = defaultDevice;
  }
}

function guessDeviceName() {
  const ua = navigator.userAgent || '';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android';
  if (/Mac/i.test(ua)) return 'Mac';
  if (/Win/i.test(ua)) return 'Windows PC';
  return 'Unknown Device';
}

function createUuid() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function splitTags(value) {
  return String(value || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function makeTitle(text) {
  const firstLine = String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);

  return (firstLine || '新規ページ').slice(0, 80);
}

function formatDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('./sw.js');
  } catch (error) {
    console.warn('Service Worker registration failed', error);
  }
}

function runSelfTests() {
  const tests = [
    ['makeTitle first line', makeTitle('\n  Hello  \nWorld'), 'Hello'],
    ['makeTitle fallback', makeTitle('  \n  '), '新規ページ'],
    ['splitTags trims', JSON.stringify(splitTags(' a, ,b , c ')), JSON.stringify(['a', 'b', 'c'])],
    ['formatDate invalid passthrough', formatDate('not-date'), 'not-date'],
  ];

  tests.forEach(([name, actual, expected]) => {
    console.assert(actual === expected, `[test failed] ${name}`, { actual, expected });
  });
}
