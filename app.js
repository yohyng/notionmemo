const APP_VERSION = 'v0.3.4 simple-memo-title-edit';
const APP_BUILD = '2026-05-06';

const STORAGE_KEY = 'instant_memo_settings_v3_diagnostics';
const QUEUE_KEY = 'instant_memo_queue_v3_diagnostics';
const CACHE_KEY = 'instant_memo_recent_cache_v3_diagnostics';

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
  diagnose: $('diagnoseButton'),
  diagnosticsPanel: $('diagnosticsPanel'),
  diagnosticsSteps: $('diagnosticsSteps'),
  diagnosticsRaw: $('diagnosticsRaw'),
  clearDiagnostics: $('clearDiagnosticsButton'),
  versionBadge: $('versionBadge'),
  versionDialog: $('versionDialog'),
  closeVersion: $('closeVersionButton'),
  versionNumber: $('versionNumber'),
  versionBuild: $('versionBuild'),
  statusDot: $('statusDot'),
  statusText: $('statusText'),
  queueBadge: $('queueBadge'),
  memoList: $('memoList'),
  editDialog: $('editDialog'),
  closeEdit: $('closeEditButton'),
  editTitle: $('editTitleInput'),
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

  els.clearDiagnostics.addEventListener('click', clearDiagnostics);
  els.versionNumber.textContent = APP_VERSION;
  els.versionBuild.textContent = APP_BUILD;
  els.versionBadge.textContent = APP_VERSION;
  els.versionBadge.addEventListener('click', () => els.versionDialog.showModal());
  els.closeVersion.addEventListener('click', () => els.versionDialog.close());
  els.diagnose.addEventListener('click', runDiagnostics);

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

async function runDiagnostics() {
  saveSettings();
  clearDiagnostics();
  els.diagnosticsPanel.classList.remove('hidden');
  els.settingsPanel.classList.remove('hidden');

  const settings = getSettings();
  const raw = {
    client: {
      userAgent: navigator.userAgent,
      online: navigator.onLine,
      appVersion: APP_VERSION,
      appBuild: APP_BUILD,
      displayModeStandalone: window.matchMedia('(display-mode: standalone)').matches,
      manifestLinked: Boolean(document.querySelector('link[rel="manifest"]')),
      serviceWorkerSupported: 'serviceWorker' in navigator,
      endpointConfigured: Boolean(settings.endpoint),
      secretConfigured: Boolean(settings.secret),
      device: settings.device,
    },
    checks: [],
  };

  function record(state, title, message, detail) {
    addDiagnosticStep(state, title, message);
    raw.checks.push({ state, title, message, detail });
    els.diagnosticsRaw.textContent = JSON.stringify(raw, null, 2);
  }

  setStatus('接続診断中...', 'sending');

  if (!settings.endpoint) {
    record('error', '1. PWA設定', 'GAS Endpointが未入力です。', null);
    setStatus('診断停止：GAS Endpoint未入力', 'error');
    return;
  }

  if (!settings.secret) {
    record('error', '1. PWA設定', 'App Secretが未入力です。GASのScript Propertiesに入れたAPP_SECRETと同じ値を入れてください。', null);
    setStatus('診断停止：App Secret未入力', 'error');
    return;
  }

  record('ok', '1. PWA設定', 'GAS EndpointとApp Secretは入力されています。', {
    endpoint: maskEndpoint(settings.endpoint),
  });

  const pingUrl = settings.endpoint + (settings.endpoint.includes('?') ? '&' : '?') + 'diagnosticPing=' + Date.now();

  try {
    const pingResponse = await fetch(pingUrl, {
      method: 'GET',
      cache: 'no-store',
    });
    const pingText = await pingResponse.text();
    const pingJson = safeJsonParse(pingText);

    if (!pingResponse.ok) {
      record('error', '2. GAS GET疎通', `HTTP ${pingResponse.status} で失敗しました。GASのデプロイ設定やURLを確認してください。`, {
        status: pingResponse.status,
        statusText: pingResponse.statusText,
        body: pingText.slice(0, 800),
      });
      setStatus('診断停止：GAS GET失敗', 'error');
      return;
    }

    if (!pingJson || !pingJson.ok) {
      record('warn', '2. GAS GET疎通', 'レスポンスは返りましたが、期待したJSONではありません。GAS URLがWeb Appの/execになっているか確認してください。', {
        status: pingResponse.status,
        body: pingText.slice(0, 800),
      });
    } else {
      record('ok', '2. GAS GET疎通', 'GAS Web AppのdoGet()に到達しました。', pingJson);
    }
  } catch (error) {
    record('error', '2. GAS GET疎通', 'fetchに失敗しました。URL違い、GASの公開設定、ネットワーク、CORSが疑われます。', {
      error: String(error),
      hint: 'GASのデプロイ設定は「実行ユーザー：自分」「アクセスできるユーザー：全員」にしてください。',
    });
    setStatus('診断停止：GASに到達できません', 'error');
    return;
  }

  const diagnoseResult = await callApiDetailed({ action: 'diagnose' });

  raw.diagnoseTransport = diagnoseResult;

  if (!diagnoseResult.transportOk) {
    record('error', '3. GAS POST疎通', 'POSTに失敗しました。CORS、ネットワーク、GAS URLの可能性があります。', diagnoseResult);
    setStatus('診断停止：POST失敗', 'error');
    return;
  }

  if (!diagnoseResult.json) {
    record('error', '3. GAS POST疎通', 'POSTのレスポンスがJSONとして読めませんでした。GASのエラー画面やHTMLが返っている可能性があります。', diagnoseResult);
    setStatus('診断停止：JSON読取失敗', 'error');
    return;
  }

  if (!diagnoseResult.data.ok) {
    const msg = String(diagnoseResult.data.error || '');

    if (msg.includes('Unauthorized')) {
      record('error', '3. APP_SECRET認証', 'APP_SECRETが一致していません。GASのScript PropertiesのAPP_SECRETと、PWA設定のApp Secretを完全一致させてください。', diagnoseResult.data);
      setStatus('診断停止：APP_SECRET不一致', 'error');
      return;
    }

    record('error', '3. GAS診断API', 'GASのdiagnoseアクションがエラーを返しました。', diagnoseResult.data);
    setStatus('診断停止：GAS診断エラー', 'error');
    return;
  }

  record('ok', '3. APP_SECRET認証', 'APP_SECRETは一致しています。GASのdiagnoseアクションに到達しました。', diagnoseResult.data);

  const gasSteps = Array.isArray(diagnoseResult.data.steps) ? diagnoseResult.data.steps : [];
  gasSteps.forEach((step, index) => {
    record(step.ok ? 'ok' : (step.warning ? 'warn' : 'error'), `4.${index + 1} ${step.name}`, step.message, step.detail || null);
  });

  const hasFatalGasStep = gasSteps.some((step) => !step.ok && !step.warning);
  if (hasFatalGasStep) {
    setStatus('診断完了：GAS/Notion側にエラーあり', 'error');
    return;
  }

  const listResult = await callApiDetailed({ action: 'list', limit: 3 });
  raw.listTransport = listResult;

  if (!listResult.transportOk) {
    record('error', '5. listアクション', 'Recent Memos取得のPOSTに失敗しました。', listResult);
    setStatus('診断完了：list通信失敗', 'error');
    return;
  }

  if (!listResult.json || !listResult.data.ok) {
    record('error', '5. listアクション', 'Notion DBから最近のメモ取得に失敗しました。Sort対象の「日付」プロパティ名や型を確認してください。', listResult.data || listResult);
    setStatus('診断完了：list失敗', 'error');
    return;
  }

  record('ok', '5. listアクション', `Recent Memos取得に成功しました。取得件数: ${Array.isArray(listResult.data.items) ? listResult.data.items.length : 0}`, listResult.data);
  setStatus('接続診断OK', 'success');
}

function clearDiagnostics() {
  els.diagnosticsSteps.innerHTML = '';
  els.diagnosticsRaw.textContent = '';
}

function addDiagnosticStep(state, title, message) {
  const icon = state === 'ok' ? '✓' : state === 'warn' ? '!' : state === 'error' ? '×' : '•';
  const item = document.createElement('li');
  item.className = `diagnostic-step ${state}`;
  item.innerHTML = `
    <span class="diagnostic-icon">${icon}</span>
    <span><strong>${escapeHtml(title)}</strong>${escapeHtml(message)}</span>
  `;
  els.diagnosticsSteps.appendChild(item);
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
    clientId: makeUuid(),
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
  showApiError('作成に失敗しました。未送信キューに保存しました。', res);
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
    if (!silent) showApiError('取得に失敗しました', res);
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
    showApiError('メモの取得に失敗しました', res);
    return;
  }

  currentEditingMemo = res.item;
  els.editTitle.value = res.item.title || makeTitle(res.item.memo || '');
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
    title: els.editTitle.value.trim(),
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
      showApiError('更新をキャンセルしました', res);
    }
    return;
  }

  showApiError('更新に失敗しました', res);
}

async function duplicateMemo() {
  const payload = {
    action: 'create',
    clientId: makeUuid(),
    title: els.editTitle.value.trim() || makeTitle(els.editMemo.value),
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
  showApiError('保存失敗。未送信キューに保存しました', res);
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
    showApiError('他のデバイスで更新されています。再取得してください', res);
    return;
  }

  showApiError('削除に失敗しました', res);
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
  const result = await callApiDetailed(payload);
  if (!result.transportOk) {
    return {
      ok: false,
      stage: 'transport',
      error: result.error,
      diagnostic: result,
    };
  }
  if (!result.json) {
    return {
      ok: false,
      stage: 'parse',
      error: 'Response was not JSON',
      diagnostic: result,
    };
  }
  return result.data;
}

async function callApiDetailed(payload) {
  const settings = getSettings();
  const endpoint = settings.endpoint;

  const requestInfo = {
    endpoint: maskEndpoint(endpoint),
    action: payload.action,
    contentType: 'text/plain;charset=utf-8',
  };

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

    const text = await response.text();
    const data = safeJsonParse(text);

    return {
      transportOk: true,
      httpOk: response.ok,
      status: response.status,
      statusText: response.statusText,
      json: Boolean(data),
      data,
      rawTextPreview: text.slice(0, 1200),
      requestInfo,
    };
  } catch (error) {
    return {
      transportOk: false,
      error: String(error),
      requestInfo,
      hint: 'TypeError: Failed to fetch の場合は、GAS URL / 公開設定 / CORS / ネットワークを疑ってください。',
    };
  }
}

function showApiError(message, res) {
  setStatus(message, 'error');
  els.settingsPanel.classList.remove('hidden');
  els.diagnosticsPanel.classList.remove('hidden');

  addDiagnosticStep('error', 'API Error', explainApiError(res));
  els.diagnosticsRaw.textContent = JSON.stringify(res, null, 2);
}

function explainApiError(res) {
  if (!res) return '詳細不明のエラーです。接続診断を実行してください。';

  const raw = JSON.stringify(res);

  if (String(res.error || '').includes('Unauthorized') || raw.includes('Unauthorized')) {
    return 'APP_SECRETが一致していません。GASのScript PropertiesとPWA設定を確認してください。';
  }

  if (raw.includes('Missing NOTION_TOKEN')) {
    return 'GASのScript PropertiesにNOTION_TOKENがありません。';
  }

  if (raw.includes('Missing NOTION_DATABASE_ID')) {
    return 'GASのScript PropertiesにNOTION_DATABASE_IDがありません。';
  }

  if (raw.includes('object_not_found')) {
    return 'Notion DBが見つかりません。DATABASE_ID違い、またはIntegration未接続の可能性があります。';
  }

  if (raw.includes('validation_error')) {
    return 'Notion DBのプロパティ名または型がコードの想定と違う可能性があります。接続診断でプロパティチェックを確認してください。';
  }

  if (res.stage === 'transport') {
    return 'GASへの通信に失敗しました。GAS URL、公開設定、CORS、ネットワークを確認してください。';
  }

  return String(res.error || messageFromNestedNotionError(res) || '接続診断を実行してください。');
}

function messageFromNestedNotionError(obj) {
  try {
    if (obj.error && obj.error.message) return obj.error.message;
    if (obj.diagnostic && obj.diagnostic.data && obj.diagnostic.data.error) return JSON.stringify(obj.diagnostic.data.error);
  } catch {
    return '';
  }
  return '';
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

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function maskEndpoint(endpoint) {
  if (!endpoint) return '';
  return endpoint.replace(/\/s\/([^/]+)\//, '/s/********/');
}

function makeUuid() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }

  return 'client-' + Date.now() + '-' + Math.random().toString(36).slice(2);
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
    ['safeJsonParse valid', safeJsonParse('{"ok":true}').ok, true],
    ['safeJsonParse invalid', safeJsonParse('<html>') === null, true],
    ['makeUuid returns value', typeof makeUuid() === 'string' && makeUuid().length > 8, true],
  ];

  tests.forEach(([name, actual, expected]) => {
    console.assert(actual === expected, `[test failed] ${name}`, { actual, expected });
  });
}
