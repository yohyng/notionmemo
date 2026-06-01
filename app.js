const APP_VERSION = 'v0.5.0 handwriting';
const APP_BUILD = '2026-06-01';

const STORAGE_KEY = 'instant_memo_settings_v4_dual_db';
const QUEUE_KEY = 'instant_memo_queue_v3_diagnostics';
const CACHE_KEY = 'instant_memo_recent_cache_v3_diagnostics';

const $ = (id) => document.getElementById(id);

const els = {
  memo: $('memoInput'),
  url: $('urlInput'),
  tags: $('tagsInput'),
  category: $('categoryInput'),
  device: $('deviceInput'),
  noteEndpoint: $('noteEndpointInput'),
  noteSecret: $('noteSecretInput'),
  noteLabel: $('noteLabelInput'),
  memoEndpoint: $('memoEndpointInput'),
  memoSecret: $('memoSecretInput'),
  memoLabel: $('memoLabelInput'),
  settingsPanel: $('settingsPanel'),
  settingsToggle: $('settingsToggle'),
  saveSettings: $('saveSettingsButton'),
  sendNote: $('sendNoteButton'),
  sendMemo: $('sendMemoButton'),
  refresh: $('refreshButton'),
  flushQueue: $('flushQueueButton'),
  diagnoseNote: $('diagnoseNoteButton'),
  diagnoseMemo: $('diagnoseMemoButton'),
  diagnosticsNotePanel: $('diagnosticsNotePanel'),
  diagnosticsNoteSteps: $('diagnosticsNoteSteps'),
  diagnosticsNoteRaw: $('diagnosticsNoteRaw'),
  clearDiagnosticsNote: $('clearDiagnosticsNoteButton'),
  diagnosticsMemoPanel: $('diagnosticsMemoPanel'),
  diagnosticsMemoSteps: $('diagnosticsMemoSteps'),
  diagnosticsMemoRaw: $('diagnosticsMemoRaw'),
  clearDiagnosticsMemo: $('clearDiagnosticsMemoButton'),
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
  tabTextButton: $('tabTextButton'),
  tabDrawButton: $('tabDrawButton'),
  drawArea: $('drawArea'),
  drawCanvas: $('drawCanvas'),
  canvasWrap: $('canvasWrap'),
  penTool: $('penToolButton'),
  eraserTool: $('eraserToolButton'),
  penSize: $('penSizeInput'),
  undo: $('undoButton'),
  clearCanvas: $('clearCanvasButton'),
};

let currentEditingMemo = null;
let activeTab = 'text';

const draw = {
  canvas: null,
  ctx: null,
  strokes: [],
  current: null,
  tool: 'pen',
  color: '#1f1f1f',
  size: 3,
  activePointerId: null,
  rect: null,
  cssWidth: 0,
  cssHeight: 0,
  ready: false,
};

init();

function init() {
  runSelfTests();
  loadSettings();
  updateSendButtonLabels();
  renderQueueBadge();
  registerServiceWorker();
  renderCachedList();

  requestAnimationFrame(() => els.memo.focus());

  els.settingsToggle.addEventListener('click', () => {
    els.settingsPanel.classList.toggle('hidden');
  });

  els.saveSettings.addEventListener('click', () => {
    saveSettings();
    updateSendButtonLabels();
    setStatus('設定を保存しました', 'success');
    els.memo.focus();
  });

  els.versionNumber.textContent = APP_VERSION;
  els.versionBuild.textContent = APP_BUILD;
  els.versionBadge.textContent = APP_VERSION;
  els.versionBadge.addEventListener('click', () => els.versionDialog.showModal());
  els.closeVersion.addEventListener('click', () => els.versionDialog.close());

  els.diagnoseNote.addEventListener('click', () => runDiagnostics('note'));
  els.diagnoseMemo.addEventListener('click', () => runDiagnostics('memo'));
  els.clearDiagnosticsNote.addEventListener('click', () => clearDiagnostics('note'));
  els.clearDiagnosticsMemo.addEventListener('click', () => clearDiagnostics('memo'));

  els.sendNote.addEventListener('click', () => handleSend('note'));
  els.sendMemo.addEventListener('click', () => handleSend('memo'));
  els.refresh.addEventListener('click', refreshList);

  els.tabTextButton.addEventListener('click', () => setTab('text'));
  els.tabDrawButton.addEventListener('click', () => setTab('draw'));
  initHandwriting();
  els.flushQueue.addEventListener('click', flushQueue);

  els.closeEdit.addEventListener('click', closeEditDialog);
  els.update.addEventListener('click', updateMemo);
  els.duplicate.addEventListener('click', duplicateMemo);
  els.trash.addEventListener('click', trashMemo);

  els.memo.addEventListener('keydown', (event) => {
    const isMod = event.ctrlKey || event.metaKey;
    if (isMod && event.key === 'Enter') {
      event.preventDefault();
      createMemo(event.shiftKey ? 'memo' : 'note');
    }
  });

  window.addEventListener('online', () => {
    setStatus('オンラインに復帰しました', 'success');
    flushQueue();
    refreshList();
  });

  refreshList({ silent: true });
}

function updateSendButtonLabels() {
  const settings = getSettings();
  els.sendNote.textContent = settings.noteLabel || 'Note';
  els.sendMemo.textContent = settings.memoLabel || 'Memo';
}

// --- Diagnostics helpers ---

function getDiagEls_(target) {
  return target === 'memo'
    ? { panel: els.diagnosticsMemoPanel, steps: els.diagnosticsMemoSteps, raw: els.diagnosticsMemoRaw }
    : { panel: els.diagnosticsNotePanel, steps: els.diagnosticsNoteSteps, raw: els.diagnosticsNoteRaw };
}

function clearDiagnostics(target) {
  const d = getDiagEls_(target);
  d.steps.innerHTML = '';
  d.raw.textContent = '';
}

function addDiagnosticStep(target, state, title, message) {
  const d = getDiagEls_(target);
  const icon = state === 'ok' ? '✓' : state === 'warn' ? '!' : state === 'error' ? '×' : '•';
  const item = document.createElement('li');
  item.className = `diagnostic-step ${state}`;
  item.innerHTML = `
    <span class="diagnostic-icon">${icon}</span>
    <span><strong>${escapeHtml(title)}</strong>${escapeHtml(message)}</span>
  `;
  d.steps.appendChild(item);
}

async function runDiagnostics(target = 'note') {
  saveSettings();
  const d = getDiagEls_(target);
  clearDiagnostics(target);
  d.panel.classList.remove('hidden');
  els.settingsPanel.classList.remove('hidden');

  const settings = getSettings();
  const endpoint = target === 'memo' ? settings.memoEndpoint : settings.noteEndpoint;
  const secret   = target === 'memo' ? settings.memoSecret   : settings.noteSecret;
  const label    = target === 'memo' ? (settings.memoLabel || 'Memo') : (settings.noteLabel || 'Note');

  const raw = { client: { userAgent: navigator.userAgent, online: navigator.onLine, appVersion: APP_VERSION, target }, checks: [] };

  function record(state, title, message, detail) {
    addDiagnosticStep(target, state, title, message);
    raw.checks.push({ state, title, message, detail });
    d.raw.textContent = JSON.stringify(raw, null, 2);
  }

  setStatus(`接続診断中（${label}）...`, 'sending');

  if (!endpoint) {
    record('error', '1. 設定', `${label} Endpointが未入力です。`, null);
    setStatus(`診断停止：${label} Endpoint未入力`, 'error');
    return;
  }
  if (!secret) {
    record('error', '1. 設定', `${label} Secretが未入力です。`, null);
    setStatus(`診断停止：${label} Secret未入力`, 'error');
    return;
  }
  record('ok', '1. 設定', `${label} EndpointとSecretは入力されています。`, { endpoint: maskEndpoint(endpoint) });

  const pingUrl = endpoint + (endpoint.includes('?') ? '&' : '?') + 'diagnosticPing=' + Date.now();
  try {
    const pingResponse = await fetch(pingUrl, { method: 'GET', cache: 'no-store' });
    const pingText = await pingResponse.text();
    const pingJson = safeJsonParse(pingText);
    if (!pingResponse.ok) {
      record('error', '2. GAS GET疎通', `HTTP ${pingResponse.status} で失敗しました。GASのデプロイ設定やURLを確認してください。`, { status: pingResponse.status, body: pingText.slice(0, 800) });
      setStatus('診断停止：GAS GET失敗', 'error');
      return;
    }
    if (!pingJson || !pingJson.ok) {
      record('warn', '2. GAS GET疎通', 'レスポンスは返りましたが、期待したJSONではありません。GAS URLがWeb Appの/execになっているか確認してください。', { status: pingResponse.status, body: pingText.slice(0, 800) });
    } else {
      record('ok', '2. GAS GET疎通', 'GAS Web AppのdoGet()に到達しました。', pingJson);
    }
  } catch (error) {
    record('error', '2. GAS GET疎通', 'fetchに失敗しました。URL違い、GASの公開設定、ネットワーク、CORSが疑われます。', { error: String(error) });
    setStatus('診断停止：GASに到達できません', 'error');
    return;
  }

  const diagnoseResult = await callApiDetailed({ action: 'diagnose', _diagTarget: target }, endpoint, secret);
  raw.diagnoseTransport = diagnoseResult;

  if (!diagnoseResult.transportOk) {
    record('error', '3. GAS POST疎通', 'POSTに失敗しました。CORS、ネットワーク、GAS URLの可能性があります。', diagnoseResult);
    setStatus('診断停止：POST失敗', 'error');
    return;
  }
  if (!diagnoseResult.json) {
    record('error', '3. GAS POST疎通', 'POSTのレスポンスがJSONとして読めませんでした。', diagnoseResult);
    setStatus('診断停止：JSON読取失敗', 'error');
    return;
  }
  if (!diagnoseResult.data.ok) {
    const msg = String(diagnoseResult.data.error || '');
    if (msg.includes('Unauthorized')) {
      record('error', '3. APP_SECRET認証', `APP_SECRETが一致していません。GASのScript PropertiesのAPP_SECRETと、${label} Secretを完全一致させてください。`, diagnoseResult.data);
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
    setStatus(`診断完了：GAS/Notion側にエラーあり（${label}）`, 'error');
    return;
  }

  if (target === 'note') {
    const listResult = await callApiDetailed({ action: 'list', limit: 3 }, endpoint, secret);
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
  }

  setStatus(`接続診断OK（${label}）`, 'success');
}

// --- Memo CRUD ---

async function createMemo(target = 'note') {
  const settings = getSettings();
  const memo = els.memo.value.trim();

  const endpoint = target === 'memo' ? settings.memoEndpoint : settings.noteEndpoint;
  const secret   = target === 'memo' ? settings.memoSecret   : settings.noteSecret;
  const label    = target === 'memo' ? (settings.memoLabel || 'Memo') : (settings.noteLabel || 'Note');

  if (!memo) { setStatus('メモが空です', 'error'); return; }

  if (!endpoint || !secret) {
    setStatus(`${label}のEndpointとSecretを設定してください`, 'error');
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
    _target: target,
  };

  setStatus(`${label}に送信中...`, 'sending');
  const res = await callApi(payload, endpoint, secret);

  if (res.ok) {
    els.memo.value = '';
    els.url.value = '';
    setStatus(`${label} DBに保存しました`, 'success');
    await refreshList({ silent: true });
    els.memo.focus();
    return;
  }

  enqueue(payload);
  showApiError(`${label}への作成に失敗しました。未送信キューに保存しました。`, res, target);
  renderQueueBadge();
}

async function refreshList(options = {}) {
  const { silent = false } = options;
  const settings = getSettings();

  if (!settings.noteEndpoint || !settings.noteSecret) {
    if (!silent) setStatus('Note のEndpointとSecretを設定してください', 'error');
    return;
  }

  if (!silent) setStatus('Notion DBを取得中...', 'sending');
  const res = await callApi({ action: 'list', limit: 30 }, settings.noteEndpoint, settings.noteSecret);

  if (!res.ok) {
    if (!silent) showApiError('取得に失敗しました', res, 'note');
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
    const title    = escapeHtml(item.title || makeTitle(item.memo || ''));
    const memo     = escapeHtml(item.memo || '');
    const date     = escapeHtml(formatDate(item.date || item.createdTime || item.lastEditedTime || ''));
    const category = escapeHtml(item.category || 'Memo');
    const tags     = Array.isArray(item.tags) ? item.tags : [];

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
  const settings = getSettings();
  const res = await callApi({ action: 'get', pageId }, settings.noteEndpoint, settings.noteSecret);

  if (!res.ok || !res.item) { showApiError('メモの取得に失敗しました', res, 'note'); return; }

  currentEditingMemo = res.item;
  els.editTitle.value    = res.item.title || makeTitle(res.item.memo || '');
  els.editMemo.value     = res.item.memo || '';
  els.editUrl.value      = res.item.url || '';
  els.editTags.value     = Array.isArray(res.item.tags) ? res.item.tags.join(', ') : '';
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

  const settings = getSettings();
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

  if (!payload.memo) { setStatus('メモが空です', 'error'); return; }

  setStatus('更新中...', 'sending');
  const res = await callApi(payload, settings.noteEndpoint, settings.noteSecret);

  if (res.ok) {
    setStatus('更新しました', 'success');
    closeEditDialog();
    await refreshList({ silent: true });
    return;
  }

  if (res.conflict) {
    const saveAsNew = window.confirm('他のデバイスで更新されています。上書きせず、別メモとして保存しますか？');
    if (saveAsNew) { await duplicateMemo(); } else { showApiError('更新をキャンセルしました', res, 'note'); }
    return;
  }

  showApiError('更新に失敗しました', res, 'note');
}

async function duplicateMemo() {
  const settings = getSettings();
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
    _target: 'note',
  };

  if (!payload.memo) { setStatus('メモが空です', 'error'); return; }

  setStatus('別メモとして保存中...', 'sending');
  const res = await callApi(payload, settings.noteEndpoint, settings.noteSecret);

  if (res.ok) {
    setStatus('別メモとして保存しました', 'success');
    closeEditDialog();
    await refreshList({ silent: true });
    return;
  }

  enqueue(payload);
  showApiError('保存失敗。未送信キューに保存しました', res, 'note');
  renderQueueBadge();
}

async function trashMemo() {
  if (!currentEditingMemo) return;

  const confirmed = window.confirm('このメモをNotionのゴミ箱へ移動しますか？');
  if (!confirmed) return;

  const settings = getSettings();
  setStatus('削除中...', 'sending');
  const res = await callApi({
    action: 'trash',
    pageId: currentEditingMemo.pageId,
    expectedLastEditedTime: currentEditingMemo.lastEditedTime,
  }, settings.noteEndpoint, settings.noteSecret);

  if (res.ok) {
    setStatus('ゴミ箱へ移動しました', 'success');
    closeEditDialog();
    await refreshList({ silent: true });
    return;
  }

  if (res.conflict) { showApiError('他のデバイスで更新されています。再取得してください', res, 'note'); return; }
  showApiError('削除に失敗しました', res, 'note');
}

async function flushQueue() {
  const queue = getQueue();
  const settings = getSettings();

  if (!queue.length) { setStatus('未送信メモはありません', 'idle'); return; }

  setStatus(`未送信 ${queue.length} 件を再送中...`, 'sending');

  const rest = [];
  for (const item of queue) {
    const target   = item._target || 'note';
    const endpoint = target === 'memo' ? settings.memoEndpoint : settings.noteEndpoint;
    const secret   = target === 'memo' ? settings.memoSecret   : settings.noteSecret;
    const res = await callApi(item, endpoint, secret);
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

// --- API ---

async function callApi(payload, endpoint, secret) {
  const result = await callApiDetailed(payload, endpoint, secret);
  if (!result.transportOk) return { ok: false, stage: 'transport', error: result.error, diagnostic: result };
  if (!result.json)        return { ok: false, stage: 'parse',     error: 'Response was not JSON', diagnostic: result };
  return result.data;
}

async function callApiDetailed(payload, endpoint, secret) {
  const requestInfo = { endpoint: maskEndpoint(endpoint), action: payload.action };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ secret, ...payload }),
    });
    const text = await response.text();
    const data = safeJsonParse(text);
    return { transportOk: true, httpOk: response.ok, status: response.status, statusText: response.statusText, json: Boolean(data), data, rawTextPreview: text.slice(0, 1200), requestInfo };
  } catch (error) {
    return { transportOk: false, error: String(error), requestInfo, hint: 'TypeError: Failed to fetch の場合は、GAS URL / 公開設定 / CORS / ネットワークを疑ってください。' };
  }
}

function showApiError(message, res, target = 'note') {
  setStatus(message, 'error');
  const d = getDiagEls_(target);
  els.settingsPanel.classList.remove('hidden');
  d.panel.classList.remove('hidden');
  addDiagnosticStep(target, 'error', 'API Error', explainApiError(res));
  d.raw.textContent = JSON.stringify(res, null, 2);
}

function explainApiError(res) {
  if (!res) return '詳細不明のエラーです。接続診断を実行してください。';
  const raw = JSON.stringify(res);
  if (String(res.error || '').includes('Unauthorized') || raw.includes('Unauthorized')) return 'APP_SECRETが一致していません。GASのScript PropertiesとSecretを確認してください。';
  if (raw.includes('Missing NOTION_TOKEN'))       return 'GASのScript PropertiesにNOTION_TOKENがありません。';
  if (raw.includes('Missing NOTION_DATABASE_ID')) return 'GASのScript PropertiesにNOTION_DATABASE_IDがありません。';
  if (raw.includes('object_not_found'))           return 'Notion DBが見つかりません。DATABASE_ID違い、またはIntegration未接続の可能性があります。';
  if (raw.includes('validation_error'))           return 'Notion DBのプロパティ名または型がコードの想定と違う可能性があります。接続診断でプロパティチェックを確認してください。';
  if (res.stage === 'transport')                  return 'GASへの通信に失敗しました。GAS URL、公開設定、CORS、ネットワークを確認してください。';
  return String(res.error || messageFromNestedNotionError(res) || '接続診断を実行してください。');
}

function messageFromNestedNotionError(obj) {
  try {
    if (obj.error && obj.error.message) return obj.error.message;
    if (obj.diagnostic && obj.diagnostic.data && obj.diagnostic.data.error) return JSON.stringify(obj.diagnostic.data.error);
  } catch { return ''; }
  return '';
}

// --- Queue ---

function enqueue(payload) {
  const queue = getQueue();
  queue.push(payload);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

function getQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; }
}

function renderQueueBadge() {
  const count = getQueue().length;
  els.queueBadge.textContent = String(count);
  els.queueBadge.classList.toggle('hidden', count === 0);
}

// --- Status ---

function setStatus(text, state = 'idle') {
  els.statusText.textContent = text;
  els.statusDot.className = `status-dot ${state}`;
}

// --- Settings ---

function getSettings() {
  return {
    noteEndpoint: els.noteEndpoint.value.trim(),
    noteSecret:   els.noteSecret.value.trim(),
    noteLabel:    els.noteLabel.value.trim(),
    memoEndpoint: els.memoEndpoint.value.trim(),
    memoSecret:   els.memoSecret.value.trim(),
    memoLabel:    els.memoLabel.value.trim(),
    tags:         els.tags.value.trim(),
    category:     els.category.value.trim(),
    device:       els.device.value.trim(),
  };
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(getSettings()));
}

function loadSettings() {
  const defaultDevice = guessDeviceName();
  try {
    const settings = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    els.noteEndpoint.value = settings.noteEndpoint || '';
    els.noteSecret.value   = settings.noteSecret   || '';
    els.noteLabel.value    = settings.noteLabel    || '';
    els.memoEndpoint.value = settings.memoEndpoint || '';
    els.memoSecret.value   = settings.memoSecret   || '';
    els.memoLabel.value    = settings.memoLabel    || '';
    els.tags.value         = settings.tags         || 'idea, memo';
    els.category.value     = settings.category     || 'Memo';
    els.device.value       = settings.device       || defaultDevice;
  } catch {
    els.tags.value   = 'idea, memo';
    els.category.value = 'Memo';
    els.device.value = defaultDevice;
  }
}

// --- Utilities ---

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
  return String(value || '').split(',').map((tag) => tag.trim()).filter(Boolean);
}

function makeTitle(text) {
  const firstLine = String(text || '').split('\n').map((line) => line.trim()).find(Boolean);
  return (firstLine || '新規ページ').slice(0, 80);
}

function formatDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function safeJsonParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function maskEndpoint(endpoint) {
  if (!endpoint) return '';
  return endpoint.replace(/\/s\/([^/]+)\//, '/s/********/');
}

function makeUuid() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  return 'client-' + Date.now() + '-' + Math.random().toString(36).slice(2);
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try { await navigator.serviceWorker.register('./sw.js'); } catch (error) { console.warn('Service Worker registration failed', error); }
}

// --- Tabs / send dispatch ---

function handleSend(target) {
  if (activeTab === 'draw') createHandwriting(target);
  else createMemo(target);
}

function setTab(tab) {
  activeTab = tab;
  const isDraw = tab === 'draw';
  els.tabTextButton.classList.toggle('active', !isDraw);
  els.tabDrawButton.classList.toggle('active', isDraw);
  els.memo.classList.toggle('hidden', isDraw);
  els.drawArea.classList.toggle('hidden', !isDraw);
  if (isDraw) {
    requestAnimationFrame(setupCanvas);
  } else {
    requestAnimationFrame(() => els.memo.focus());
  }
}

// --- Handwriting ---

function initHandwriting() {
  draw.canvas = els.drawCanvas;
  // desynchronized: ブラウザ内のバッファリングを飛ばして低レイテンシ描画に寄せる
  draw.ctx = draw.canvas.getContext('2d', { desynchronized: true });

  els.penTool.addEventListener('click', () => setTool('pen'));
  els.eraserTool.addEventListener('click', () => setTool('eraser'));
  els.penSize.addEventListener('input', () => { draw.size = Number(els.penSize.value) || 3; });
  els.undo.addEventListener('click', undoStroke);
  els.clearCanvas.addEventListener('click', clearCanvas);

  document.querySelectorAll('.color-swatch').forEach((swatch) => {
    swatch.addEventListener('click', () => {
      draw.color = swatch.dataset.color;
      setTool('pen');
      document.querySelectorAll('.color-swatch').forEach((s) => s.classList.toggle('active', s === swatch));
    });
  });

  const c = draw.canvas;
  c.addEventListener('pointerdown', onPointerDown);
  c.addEventListener('pointermove', onPointerMove);
  c.addEventListener('pointerup', onPointerUp);
  c.addEventListener('pointercancel', onPointerUp);

  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => { if (activeTab === 'draw') setupCanvas(); });
    ro.observe(els.canvasWrap);
  }
}

function setTool(tool) {
  draw.tool = tool;
  els.penTool.classList.toggle('active', tool === 'pen');
  els.eraserTool.classList.toggle('active', tool === 'eraser');
}

function setupCanvas() {
  const rect = els.canvasWrap.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const dpr = window.devicePixelRatio || 1;
  // 高DPI（Retina相当）対応：内部解像度を物理ピクセルに合わせる
  draw.canvas.width = Math.round(rect.width * dpr);
  draw.canvas.height = Math.round(rect.height * dpr);
  draw.canvas.style.width = rect.width + 'px';
  draw.canvas.style.height = rect.height + 'px';
  draw.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw.cssWidth = rect.width;
  draw.cssHeight = rect.height;
  draw.ready = true;
  redrawAll();
}

function pointerToCanvas(e) {
  const rect = draw.rect || draw.canvas.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
    pressure: e.pressure && e.pressure > 0 ? e.pressure : 0.5,
  };
}

function onPointerDown(e) {
  if (!draw.ready) setupCanvas();
  // パームリジェクション：すでに描画中のポインタがあれば無視（手のひら誤爆対策）
  if (draw.activePointerId !== null) return;
  e.preventDefault();
  draw.activePointerId = e.pointerId;
  draw.rect = draw.canvas.getBoundingClientRect();
  const pt = pointerToCanvas(e);
  draw.current = { tool: draw.tool, color: draw.color, size: draw.size, points: [pt] };
  drawDot(pt, draw.current);
  try { draw.canvas.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
}

function onPointerMove(e) {
  if (draw.activePointerId !== e.pointerId || !draw.current) return;
  e.preventDefault();
  // 合体タッチ：1フレーム内に間引かれた中間点も全部拾って滑らかさを上げる
  const events = (e.getCoalescedEvents && e.getCoalescedEvents().length) ? e.getCoalescedEvents() : [e];
  for (const ev of events) {
    draw.current.points.push(pointerToCanvas(ev));
    drawLiveSegment();
  }
}

function onPointerUp(e) {
  if (draw.activePointerId !== e.pointerId) return;
  if (draw.current && draw.current.points.length) draw.strokes.push(draw.current);
  draw.current = null;
  draw.activePointerId = null;
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function lineWidthFor(stroke, pressure) {
  if (stroke.tool === 'eraser') return stroke.size * 4 + 8;
  // 筆圧で線幅を可変に（Sペンの強弱が出る）
  return stroke.size * (0.4 + 0.9 * pressure);
}

function applyStrokeStyle(ctx, stroke) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (stroke.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = stroke.color;
  }
}

function drawDot(pt, stroke) {
  const ctx = draw.ctx;
  applyStrokeStyle(ctx, stroke);
  const w = lineWidthFor(stroke, pt.pressure);
  ctx.beginPath();
  ctx.arc(pt.x, pt.y, Math.max(w / 2, 0.6), 0, Math.PI * 2);
  ctx.fillStyle = stroke.tool === 'eraser' ? 'rgba(0,0,0,1)' : stroke.color;
  ctx.fill();
}

// 直近の点だけを即時に描く（全再描画しないことで遅延を抑える）
function drawLiveSegment() {
  const pts = draw.current.points;
  const n = pts.length;
  if (n < 2) return;
  const ctx = draw.ctx;
  applyStrokeStyle(ctx, draw.current);
  const p1 = pts[n - 2];
  const p2 = pts[n - 1];
  ctx.lineWidth = lineWidthFor(draw.current, (p1.pressure + p2.pressure) / 2);
  ctx.beginPath();
  if (n >= 3) {
    const p0 = pts[n - 3];
    const m1 = midpoint(p0, p1);
    const m2 = midpoint(p1, p2);
    ctx.moveTo(m1.x, m1.y);
    ctx.quadraticCurveTo(p1.x, p1.y, m2.x, m2.y);
  } else {
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
  }
  ctx.stroke();
}

function drawWholeStroke(ctx, stroke) {
  const pts = stroke.points;
  if (pts.length === 1) { drawDot(pts[0], stroke); return; }
  applyStrokeStyle(ctx, stroke);
  for (let i = 1; i < pts.length; i++) {
    const p1 = pts[i - 1];
    const p2 = pts[i];
    ctx.lineWidth = lineWidthFor(stroke, (p1.pressure + p2.pressure) / 2);
    ctx.beginPath();
    if (i >= 2) {
      const p0 = pts[i - 2];
      const m1 = midpoint(p0, p1);
      const m2 = midpoint(p1, p2);
      ctx.moveTo(m1.x, m1.y);
      ctx.quadraticCurveTo(p1.x, p1.y, m2.x, m2.y);
    } else {
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
    }
    ctx.stroke();
  }
}

function redrawAll() {
  const ctx = draw.ctx;
  ctx.clearRect(0, 0, draw.cssWidth, draw.cssHeight);
  for (const stroke of draw.strokes) drawWholeStroke(ctx, stroke);
}

function undoStroke() {
  draw.strokes.pop();
  redrawAll();
}

function clearCanvas() {
  draw.strokes = [];
  draw.current = null;
  redrawAll();
}

function isCanvasEmpty() {
  return draw.strokes.length === 0 && !draw.current;
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    if (canvas.toBlob) canvas.toBlob((b) => resolve(b), type, quality);
    else resolve(null);
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// 白背景を合成しつつ、5MB以内になるまでWebPの品質→サイズの順で落とす
async function exportImageBlob() {
  const srcW = draw.canvas.width;
  const srcH = draw.canvas.height;
  const maxEdge = 2048;
  const longEdge = Math.max(srcW, srcH);
  const scale = longEdge > maxEdge ? maxEdge / longEdge : 1;

  let outW = Math.max(Math.round(srcW * scale), 1);
  let outH = Math.max(Math.round(srcH * scale), 1);

  const render = (w, h) => {
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const octx = out.getContext('2d');
    octx.fillStyle = '#ffffff';
    octx.fillRect(0, 0, w, h);
    octx.drawImage(draw.canvas, 0, 0, w, h);
    return out;
  };

  const maxBytes = 5 * 1024 * 1024;
  let out = render(outW, outH);
  let quality = 0.92;
  let blob = await canvasToBlob(out, 'image/webp', quality);

  while (blob && blob.size > maxBytes && quality > 0.4) {
    quality -= 0.12;
    blob = await canvasToBlob(out, 'image/webp', quality);
  }

  // それでも超える場合は解像度を段階的に縮小
  while (blob && blob.size > maxBytes && Math.max(outW, outH) > 640) {
    outW = Math.round(outW * 0.75);
    outH = Math.round(outH * 0.75);
    out = render(outW, outH);
    blob = await canvasToBlob(out, 'image/webp', 0.8);
  }

  return blob;
}

async function createHandwriting(target) {
  const settings = getSettings();
  const endpoint = target === 'memo' ? settings.memoEndpoint : settings.noteEndpoint;
  const secret   = target === 'memo' ? settings.memoSecret   : settings.noteSecret;
  const label    = target === 'memo' ? (settings.memoLabel || 'Memo') : (settings.noteLabel || 'Note');

  if (isCanvasEmpty()) { setStatus('手書きが空です', 'error'); return; }

  if (!endpoint || !secret) {
    setStatus(`${label}のEndpointとSecretを設定してください`, 'error');
    els.settingsPanel.classList.remove('hidden');
    return;
  }

  setStatus('画像を準備中...', 'sending');
  const blob = await exportImageBlob();
  if (!blob) { setStatus('画像の生成に失敗しました', 'error'); return; }

  const sizeMb = (blob.size / (1024 * 1024)).toFixed(2);
  const imageBase64 = await blobToBase64(blob);

  saveSettings();

  const now = new Date();
  const payload = {
    action: 'createImage',
    clientId: makeUuid(),
    imageBase64,
    mimeType: blob.type || 'image/webp',
    title: `手書き ${formatDate(now.toISOString())}`,
    url: els.url.value.trim(),
    tags: splitTags(els.tags.value),
    category: els.category.value.trim(),
    device: els.device.value.trim(),
    date: now.toISOString(),
    _target: target,
  };

  setStatus(`${label}に送信中... (${sizeMb}MB)`, 'sending');
  const res = await callApi(payload, endpoint, secret);

  if (res.ok) {
    clearCanvas();
    setStatus(`${label} DBに手書きを保存しました`, 'success');
    await refreshList({ silent: true });
    return;
  }

  enqueue(payload);
  showApiError(`${label}への送信に失敗しました。未送信キューに保存しました。`, res, target);
  renderQueueBadge();
}

function runSelfTests() {
  const tests = [
    ['makeTitle first line',    makeTitle('\n  Hello  \nWorld'),          'Hello'],
    ['makeTitle fallback',      makeTitle('  \n  '),                      '新規ページ'],
    ['splitTags trims',         JSON.stringify(splitTags(' a, ,b , c ')), JSON.stringify(['a', 'b', 'c'])],
    ['formatDate invalid',      formatDate('not-date'),                    'not-date'],
    ['safeJsonParse valid',     safeJsonParse('{"ok":true}').ok,           true],
    ['safeJsonParse invalid',   safeJsonParse('<html>') === null,          true],
    ['makeUuid returns value',  typeof makeUuid() === 'string' && makeUuid().length > 8, true],
  ];
  tests.forEach(([name, actual, expected]) => {
    console.assert(actual === expected, `[test failed] ${name}`, { actual, expected });
  });
}
