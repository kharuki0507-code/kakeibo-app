/**
 * 家計積立管理アプリ - メインJavaScript
 * =====================================================
 * 機能一覧:
 *  - 月収入の入力・保存
 *  - 積立項目の追加・編集・削除・進捗管理
 *  - 急な出費の再配分提案ロジック
 *  - ご褒美判定ロジック
 *  - Chart.js によるグラフ描画
 *  - 応援キャラ表示・お祝いアニメーション
 *  - PWA Service Worker 登録
 * =====================================================
 */

'use strict';

// ============================================================
// アプリ状態（localStorage と同期するデータモデル）
// ============================================================
// ============================================================
// アカウント管理
// ============================================================

/** 現在のアカウント名（未選択時は null） */
let currentAccount = null;

/** デフォルトのアプリ状態を返す */
function getDefaultState() {
  return {
    income:      {},   // { "2024-01": 200000, ... } 手取り給与
    bonus:       {},   // { "2024-06": 80000, ... }  賞与・臨時収入（月ごとの累積）
    items:       [],   // 積立項目配列
    rewards:     [],   // ご褒美配列
    emergencies: [],   // 急な出費履歴
    charaImage:  null, // 応援キャラ画像（base64）
  };
}

/** アカウント一覧を localStorage から取得 */
function getAccounts() {
  try { return JSON.parse(localStorage.getItem('kakeibo_accounts') || '[]'); }
  catch { return []; }
}

/** アカウント一覧を localStorage に保存 */
function saveAccountsList(accounts) {
  localStorage.setItem('kakeibo_accounts', JSON.stringify(accounts));
}

/** アカウント選択画面を表示 */
function showAccountPicker() {
  document.getElementById('account-picker-overlay').style.display = 'flex';
  document.getElementById('new-account-form').style.display = 'none';
  document.getElementById('new-account-area').style.display  = '';
  renderAccountCards();
}

/** アカウントカード一覧を描画 */
function renderAccountCards() {
  const accounts  = getAccounts();
  const container = document.getElementById('account-cards');
  container.innerHTML = '';

  if (accounts.length === 0) {
    container.innerHTML = '<p style="color:rgba(255,255,255,0.75); font-size:14px; margin-bottom:12px;">まだアカウントがありません</p>';
    return;
  }

  const emojis = ['😊', '😄', '🌸', '⭐', '🌙', '🍀', '🎵', '🦋'];
  accounts.forEach((name, i) => {
    const div = document.createElement('div');
    div.className = 'account-card';
    div.onclick   = () => selectAccount(name);
    div.innerHTML = `
      <div class="account-avatar">${emojis[i % emojis.length]}</div>
      <div class="account-card-name">${escapeHtml(name)}</div>
      <div style="font-size:20px; color:rgba(255,255,255,0.6);">›</div>
    `;
    container.appendChild(div);
  });
}

/** 新規アカウント作成フォームを表示 */
function showNewAccountForm() {
  document.getElementById('new-account-area').style.display  = 'none';
  document.getElementById('new-account-form').style.display  = '';
  document.getElementById('new-account-name').value          = '';
  document.getElementById('new-account-name').focus();
}

/** 新規アカウント作成をキャンセル */
function cancelNewAccount() {
  document.getElementById('new-account-form').style.display  = 'none';
  document.getElementById('new-account-area').style.display  = '';
}

/** 新規アカウントを作成してそのまま選択 */
function createAccount() {
  const name = document.getElementById('new-account-name').value.trim();
  if (!name) { alert('名前を入力してください'); return; }

  const accounts = getAccounts();
  if (accounts.includes(name)) { alert('その名前はすでに使われています'); return; }

  accounts.push(name);
  saveAccountsList(accounts);
  selectAccount(name);
}

/**
 * アカウントを選択し、そのアカウントのデータをロードしてアプリを初期化する
 * @param {string} name - アカウント名
 */
function selectAccount(name) {
  currentAccount = name;
  localStorage.setItem('kakeibo_active', name);

  // オーバーレイを閉じる
  document.getElementById('account-picker-overlay').style.display = 'none';

  // ヘッダー・設定ページのアカウント名を更新
  const badge = document.getElementById('current-account-name');
  if (badge) badge.textContent = name;
  const settingsName = document.getElementById('settings-account-name');
  if (settingsName) settingsName.textContent = name;

  // そのアカウントのデータをロードしてアプリを描画
  appState = getDefaultState();
  loadState();
  updateHeaderMonth();
  renderItems();
  renderDashboard();
  renderRewards();
  renderEmergencyHistory();
  loadCharaImage();
}

// ============================================================
// アプリ状態（アカウントごとに localStorage で管理）
// ============================================================
let appState = getDefaultState();

// 選択中の月（ナビゲーション用）。初期値は今月。
let selectedMonth = new Date().toISOString().slice(0, 7);

// 編集中の項目ID（詳細モーダル用）
let currentItemId = null;

// 再配分計算結果（適用前に保持）
let pendingRedistrib = null;

// Chart.js インスタンス（再描画時に破棄するため保持）
let chartLine = null;
let chartPie  = null;
let chartBar  = null;

// ============================================================
// 初期化
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  registerServiceWorker();
  // 前回のアカウントが保存されていれば自動選択、なければ選択画面を表示
  const active   = localStorage.getItem('kakeibo_active');
  const accounts = getAccounts();
  if (active && accounts.includes(active)) {
    selectAccount(active);
  } else {
    showAccountPicker();
  }
});

/** Service Worker を登録（PWA対応） */
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js')
      .then(() => console.log('[SW] 登録成功'))
      .catch((err) => console.warn('[SW] 登録失敗:', err));
  }
}

// ============================================================
// localStorage 操作
// ============================================================

/** データを localStorage から読み込む（アカウントごとに独立したキーを使用） */
function loadState() {
  try {
    const key   = currentAccount ? `kakeibo_data_${currentAccount}` : 'kakeibo_state';
    const saved = localStorage.getItem(key);
    if (saved) {
      appState = { ...getDefaultState(), ...JSON.parse(saved) };
    }
  } catch (e) {
    console.warn('データ読み込みエラー:', e);
  }
}

/** データを localStorage に保存する（アカウントごとに独立したキーを使用） */
function saveState() {
  try {
    const key = currentAccount ? `kakeibo_data_${currentAccount}` : 'kakeibo_state';
    localStorage.setItem(key, JSON.stringify(appState));
  } catch (e) {
    console.warn('データ保存エラー:', e);
  }
}

// ============================================================
// ユーティリティ
// ============================================================

/** 現在の年月を "YYYY-MM" 形式で返す */
function getCurrentMonth() {
  return new Date().toISOString().slice(0, 7);
}

/** 金額を日本円形式にフォーマット */
function formatYen(amount) {
  return '¥' + Math.floor(amount).toLocaleString('ja-JP');
}

/** 達成率（%）を計算。目標が0の場合は0を返す */
function calcRate(current, goal) {
  if (!goal || goal <= 0) return 0;
  return Math.min(100, Math.round((current / goal) * 100));
}

/** 現在月から期限月までの残り月数を返す */
function monthsUntilDeadline(deadlineStr) {
  if (!deadlineStr) return 999;
  const now = new Date();
  const [dy, dm] = deadlineStr.split('-').map(Number);
  const deadline = new Date(dy, dm - 1, 1);
  const months = (deadline.getFullYear() - now.getFullYear()) * 12
               + (deadline.getMonth() - now.getMonth());
  return Math.max(0, months);
}

/** 月々の推奨積立額を計算（定額設定があればそれを優先、なければ残額÷残り月数）*/
function calcMonthlyAmount(item) {
  if (item.fixed > 0) return item.fixed;
  const remain = Math.max(0, item.goal - item.current);
  const months = monthsUntilDeadline(item.deadline);
  if (months <= 0) return remain;
  return Math.ceil(remain / months);
}

/** ユニークIDを生成 */
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** ヘッダーの月表示を更新（selectedMonth を使用） */
function updateHeaderMonth() {
  const [y, m] = selectedMonth.split('-').map(Number);
  document.getElementById('header-month').textContent = `${y}年${m}月`;
  // 収入ラベルも選択中の月に合わせて更新
  const label = document.getElementById('income-label');
  if (label) label.textContent = `📥 ${y}年${m}月の手取り収入`;
}

/** 前の月へ移動 */
function prevMonth() {
  const [y, m] = selectedMonth.split('-').map(Number);
  const d = new Date(y, m - 2, 1); // m-2 = 前月（0始まりのため）
  selectedMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  updateHeaderMonth();
  renderDashboard();
  renderEmergencyHistory();
}

/** 次の月へ移動 */
function nextMonth() {
  const [y, m] = selectedMonth.split('-').map(Number);
  const d = new Date(y, m, 1); // m = 次月（0始まりのため）
  selectedMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  updateHeaderMonth();
  renderDashboard();
  renderEmergencyHistory();
}

// ============================================================
// ページ切り替え
// ============================================================
function showPage(name, btnEl) {
  // 全ページ非表示
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  // 対象ページ表示
  document.getElementById('page-' + name).classList.add('active');
  // ナビボタン状態更新
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  btnEl.classList.add('active');

  // グラフページに切り替えた時は描画
  if (name === 'graph') {
    renderCharts();
  }
}

// ============================================================
// 収入管理
// ============================================================

/**
 * 賞与・臨時収入を選択中の月に累積加算する
 * bonus オブジェクトに月ごとの合計を保持し、ダッシュボードに反映
 */
function addBonus() {
  const val = parseInt(document.getElementById('bonus-input').value);
  if (!val || val <= 0) {
    showSnackbar('正しい金額を入力してください');
    return;
  }
  if (!appState.bonus) appState.bonus = {};
  appState.bonus[selectedMonth] = (appState.bonus[selectedMonth] || 0) + val;
  document.getElementById('bonus-input').value = '';
  saveState();
  renderDashboard();
  const [y, m] = selectedMonth.split('-').map(Number);
  showSnackbar(`${y}年${m}月に賞与 ${formatYen(val)} を追加しました 🎉`);
}

/** 月収入を保存する（選択中の月に保存） */
function saveIncome() {
  const val = parseInt(document.getElementById('income-input').value);
  if (!val || val <= 0) {
    showSnackbar('正しい金額を入力してください');
    return;
  }
  appState.income[selectedMonth] = val;
  saveState();
  renderDashboard();
  const [y, m] = selectedMonth.split('-').map(Number);
  showSnackbar(`${y}年${m}月の収入を保存しました 💰`);
}

// ============================================================
// ダッシュボード描画
// ============================================================

/** ダッシュボードのサマリーを更新（selectedMonth を使用） */
function renderDashboard() {
  const income = appState.income[selectedMonth] || 0;
  const bonus  = (appState.bonus || {})[selectedMonth] || 0;
  const totalIncome = income + bonus; // 手取り＋賞与の合計

  // 月収入インプットに選択月の値を反映
  document.getElementById('income-input').value = income > 0 ? income : '';

  // 積立合計（月々の推奨積立額の合計）
  let totalMonthly = 0;
  appState.items.forEach(item => {
    totalMonthly += calcMonthlyAmount(item);
  });

  // 平均達成率
  let avgRate = 0;
  if (appState.items.length > 0) {
    const sum = appState.items.reduce((acc, item) => acc + calcRate(item.current, item.goal), 0);
    avgRate = Math.round(sum / appState.items.length);
  }

  // 月収入インプットに選択月の値を反映
  document.getElementById('income-input').value = income > 0 ? income : '';

  // 賞与表示を更新
  const bonusDisplay = document.getElementById('current-bonus-display');
  if (bonusDisplay) bonusDisplay.textContent = formatYen(bonus);

  // 積立総資産額（全項目の現在積立額の合計）
  const totalAssets = appState.items.reduce((s, item) => s + item.current, 0);

  // 積立率（月々必要積立額 ÷ 総収入）
  const savingsRate = totalIncome > 0 ? Math.round((totalMonthly / totalIncome) * 100) : 0;

  // 賞与があれば内訳を小さく表示
  const incomeHtml = bonus > 0
    ? `${formatYen(totalIncome)}<div style="font-size:10px;color:#7f8c9a;margin-top:2px;">給与+賞与 ${formatYen(bonus)}</div>`
    : formatYen(totalIncome);

  document.getElementById('sum-income').innerHTML         = incomeHtml;
  document.getElementById('sum-saving').textContent       = formatYen(totalMonthly);
  document.getElementById('sum-free').textContent         = formatYen(Math.max(0, totalIncome - totalMonthly));
  document.getElementById('sum-rate').textContent         = avgRate + '%';
  document.getElementById('sum-total-assets').textContent = formatYen(totalAssets);
  document.getElementById('sum-savings-rate').textContent = savingsRate + '%';
}

// ============================================================
// 積立項目管理
// ============================================================

/** 積立項目リストを描画 */
function renderItems() {
  const listEl = document.getElementById('item-list');
  const emptyEl = document.getElementById('empty-state');

  // 既存の項目カードを削除（emptyStateは残す）
  listEl.querySelectorAll('.saving-item').forEach(el => el.remove());

  if (appState.items.length === 0) {
    emptyEl.style.display = '';
    return;
  }
  emptyEl.style.display = 'none';

  // 優先度順（高→中→低）に並べ替え
  const sorted = [...appState.items].sort((a, b) => {
    const order = { high: 0, mid: 1, low: 2 };
    return order[a.priority] - order[b.priority];
  });

  sorted.forEach(item => {
    const el = createItemElement(item);
    listEl.appendChild(el);
  });
}

/** 積立項目のDOM要素を生成 */
function createItemElement(item) {
  const rate = calcRate(item.current, item.goal);
  const monthly = calcMonthlyAmount(item);
  const remaining = monthsUntilDeadline(item.deadline);

  // 進捗バーの色クラス
  let fillClass = '';
  if (rate >= 100)     fillClass = 'success';
  else if (rate >= 60) fillClass = '';
  else if (rate >= 30) fillClass = 'warning';
  else                 fillClass = 'danger';

  // 優先度バッジ
  const priorityLabels = { high: '高', mid: '中', low: '低' };
  const badgeClass     = { high: 'badge-high', mid: 'badge-mid', low: 'badge-low' };

  const div = document.createElement('div');
  div.className = `saving-item priority-${item.priority}`;
  div.dataset.id = item.id;
  div.onclick = () => openDetailModal(item.id);

  // 定額が設定されている場合はワンタップボタンを表示
  const fixedBtn = item.fixed > 0
    ? `<button class="quick-add-btn" onclick="event.stopPropagation(); quickAddFixed('${item.id}')" title="${formatYen(item.fixed)}を積立">
        ＋${formatYen(item.fixed)}
       </button>`
    : '';

  div.innerHTML = `
    <div class="item-header">
      <span class="item-name">${escapeHtml(item.name)}</span>
      <div style="display:flex; align-items:center; gap:6px;">
        ${fixedBtn}
        <span class="item-badge ${badgeClass[item.priority]}">
          優先度:${priorityLabels[item.priority]}
        </span>
      </div>
    </div>
    <div class="item-amounts">
      <div>
        <div style="font-size:11px; color:#7f8c9a;">積立中</div>
        <div class="current">${formatYen(item.current)}</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:11px; color:#7f8c9a;">目標 / 定額</div>
        <div>${formatYen(item.goal)}${item.fixed > 0 ? ` <span style="font-size:11px; color:#4f7cff;">/ 月${formatYen(item.fixed)}</span>` : ''}</div>
      </div>
    </div>
    <div class="progress-bar">
      <div class="progress-fill ${fillClass}" style="width:${rate}%"></div>
    </div>
    <div class="progress-text">
      <span>${rate}% 達成</span>
      <span>月々 ${formatYen(monthly)} / ${item.deadline ? `残${remaining}ヶ月` : '期限なし'}</span>
    </div>
  `;
  return div;
}

/** XSS防止のためHTMLエスケープ */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================================
// 積立項目追加・編集モーダル
// ============================================================

/** 定額積立入力に応じて「必要になる月」の必須/任意を切り替え */
function toggleDeadlineRequired() {
  const fixed = parseInt(document.getElementById('item-fixed').value) || 0;
  const label = document.getElementById('deadline-label');
  if (fixed > 0) {
    label.textContent = '必要になる月（任意）';
  } else {
    label.textContent = '必要になる月 *';
  }
}

/** 追加モーダルを開く */
function openAddItemModal() {
  currentItemId = null;
  document.getElementById('modal-item-title').textContent = '積立項目を追加';
  document.getElementById('item-name').value     = '';
  document.getElementById('item-goal').value     = '';
  document.getElementById('item-deadline').value = '';
  document.getElementById('item-priority').value = 'mid';
  document.getElementById('item-current').value  = '';
  document.getElementById('item-fixed').value    = '';
  toggleDeadlineRequired();
  openModal('modal-item');
}

/** 編集モーダルを開く（詳細モーダルの編集ボタンから） */
function editCurrentItem() {
  const item = appState.items.find(i => i.id === currentItemId);
  if (!item) return;
  closeModal('modal-detail');

  document.getElementById('modal-item-title').textContent = '積立項目を編集';
  document.getElementById('item-name').value     = item.name;
  document.getElementById('item-goal').value     = item.goal;
  document.getElementById('item-deadline').value = item.deadline;
  document.getElementById('item-priority').value = item.priority;
  document.getElementById('item-current').value  = item.current;
  document.getElementById('item-fixed').value    = item.fixed || '';
  toggleDeadlineRequired();
  openModal('modal-item');
}

/** 積立項目を保存（追加 or 更新） */
function saveItem() {
  const name     = document.getElementById('item-name').value.trim();
  const goal     = parseInt(document.getElementById('item-goal').value);
  const deadline = document.getElementById('item-deadline').value;
  const priority = document.getElementById('item-priority').value;
  const current  = parseInt(document.getElementById('item-current').value) || 0;

  const fixed = parseInt(document.getElementById('item-fixed').value) || 0;

  if (!name || !goal || (!deadline && fixed === 0)) {
    showSnackbar('必須項目を入力してください');
    return;
  }

  if (currentItemId) {
    // 更新
    const idx = appState.items.findIndex(i => i.id === currentItemId);
    if (idx !== -1) {
      appState.items[idx] = { ...appState.items[idx], name, goal, deadline, priority, current, fixed };
    }
    showSnackbar('項目を更新しました ✅');
  } else {
    // 新規追加
    appState.items.push({
      id:       generateId(),
      name,
      goal,
      deadline,
      priority,
      current,
      fixed,    // 毎月の定額積立額（0なら未設定）
      history:  [],
    });
    showSnackbar('項目を追加しました ✅');
  }

  saveState();
  renderItems();
  renderDashboard();
  closeModal('modal-item');

  // ご褒美判定を実行
  checkRewards();
}

// ============================================================
// 積立項目詳細モーダル
// ============================================================

/** 詳細モーダルを開く */
function openDetailModal(id) {
  const item = appState.items.find(i => i.id === id);
  if (!item) return;
  currentItemId = id;

  const rate    = calcRate(item.current, item.goal);
  const remain  = Math.max(0, item.goal - item.current);

  // 進捗バー色
  let fillClass = rate >= 100 ? 'success' : rate >= 30 ? '' : 'danger';

  document.getElementById('detail-title').textContent          = item.name;
  document.getElementById('detail-current').textContent        = formatYen(item.current);
  document.getElementById('detail-goal').textContent           = formatYen(item.goal);
  document.getElementById('detail-progress-fill').style.width  = rate + '%';
  document.getElementById('detail-progress-fill').className    = `progress-fill ${fillClass}`;
  document.getElementById('detail-rate').textContent           = `${rate}% 達成`;
  document.getElementById('detail-remain').textContent         = `残り ${formatYen(remain)}`;
  document.getElementById('detail-add-amount').value           = '';

  // 積立履歴テーブル
  renderHistory(item);

  openModal('modal-detail');
}

/** 月ごとの積立履歴を描画（急な出費による減額は赤字で表示） */
function renderHistory(item) {
  const tbody = document.getElementById('detail-history');
  tbody.innerHTML = '';
  if (!item.history || item.history.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:#7f8c9a;">履歴なし</td></tr>';
    return;
  }
  // 新しい順に表示
  [...item.history].reverse().forEach((h, reversedIdx) => {
    const originalIdx = item.history.length - 1 - reversedIdx;
    const tr = document.createElement('tr');
    tr.id = `hist-row-${originalIdx}`;
    const isNegative = h.amount < 0;
    const label = h.note ? ` <span style="font-size:10px;">${escapeHtml(h.note)}</span>` : '';
    const amountHtml = isNegative
      ? `<span style="color:#e74c3c; font-weight:700;">-${formatYen(Math.abs(h.amount))}${label}</span>`
      : `<span style="font-weight:600; color:#2ecc71;">+${formatYen(h.amount)}</span>`;
    tr.innerHTML = `
      <td>${h.month}</td>
      <td id="hist-amount-${originalIdx}">${amountHtml}</td>
      <td style="white-space:nowrap; text-align:right;">
        <button onclick="startEditHistory('${item.id}',${originalIdx})" style="font-size:11px;padding:2px 7px;background:#4f7cff;color:#fff;border:none;border-radius:4px;cursor:pointer;margin-right:3px;">✏️</button>
        <button onclick="deleteHistoryEntry('${item.id}',${originalIdx})" style="font-size:11px;padding:2px 7px;background:#e74c3c;color:#fff;border:none;border-radius:4px;cursor:pointer;">🗑️</button>
      </td>`;
    tbody.appendChild(tr);
  });
}

/** 履歴の編集モードを開始（行をインライン入力に切り替え） */
function startEditHistory(itemId, histIdx) {
  const item = appState.items.find(i => i.id === itemId);
  if (!item) return;
  const h = item.history[histIdx];
  const td = document.getElementById(`hist-amount-${histIdx}`);
  if (!td) return;
  td.innerHTML = `
    <input type="number" id="hist-edit-input-${histIdx}" value="${h.amount}" inputmode="numeric"
      style="width:80px;padding:2px 4px;border:1px solid #4f7cff;border-radius:4px;font-size:13px;">
    <button onclick="saveEditHistory('${itemId}',${histIdx})" style="font-size:11px;padding:2px 7px;background:#2ecc71;color:#fff;border:none;border-radius:4px;cursor:pointer;margin-left:3px;">保存</button>`;
}

/** 履歴の編集を確定する */
function saveEditHistory(itemId, histIdx) {
  const item = appState.items.find(i => i.id === itemId);
  if (!item) return;
  const newVal = parseInt(document.getElementById(`hist-edit-input-${histIdx}`).value);
  if (isNaN(newVal)) { showSnackbar('正しい金額を入力してください'); return; }
  const diff = newVal - item.history[histIdx].amount;
  item.history[histIdx].amount = newVal;
  item.current = Math.max(0, item.current + diff);
  saveState();
  renderItems();
  renderDashboard();
  openDetailModal(itemId);
  showSnackbar('履歴を更新しました ✅');
}

/** 履歴エントリを削除してcurrentを復元 */
function deleteHistoryEntry(itemId, histIdx) {
  const item = appState.items.find(i => i.id === itemId);
  if (!item) return;
  const entry = item.history[histIdx];
  item.current = Math.max(0, item.current - entry.amount);
  item.history.splice(histIdx, 1);
  saveState();
  renderItems();
  renderDashboard();
  openDetailModal(itemId);
  showSnackbar('履歴を削除しました');
}

/** 今月の積立額を追加 */
function addMonthlyAmount() {
  const amount = parseInt(document.getElementById('detail-add-amount').value);
  if (!amount || amount <= 0) {
    showSnackbar('正しい金額を入力してください');
    return;
  }

  const idx = appState.items.findIndex(i => i.id === currentItemId);
  if (idx === -1) return;

  const item  = appState.items[idx];
  const month = selectedMonth; // 選択中の月に記録

  // 現在の積立額に加算
  item.current += amount;

  // 履歴に追加（同月・通常積立は累積、急な出費メモとは別エントリ）
  const existH = item.history.find(h => h.month === month && !h.note);
  if (existH) {
    existH.amount += amount;
  } else {
    item.history.push({ month, amount });
  }

  saveState();
  renderItems();
  renderDashboard();

  // 詳細モーダルを更新
  openDetailModal(currentItemId);

  showSnackbar(`${formatYen(amount)} を積み立てました 💰`);

  // ご褒美判定（達成率が変わったため）
  checkRewards();

  // 100%達成したらお祝い演出
  const newRate = calcRate(item.current, item.goal);
  if (newRate >= 100) {
    triggerCelebration(`${item.name} 完全達成！`, true);
  } else if (newRate >= 80) {
    triggerCelebration(`${item.name} 80% 達成！`, false);
  }
}

/**
 * ワンタップ積立 — カードの「＋¥〇〇」ボタンから呼ばれる
 * 定額（item.fixed）をそのまま選択中の月に積み立てる
 */
function quickAddFixed(id) {
  const item = appState.items.find(i => i.id === id);
  if (!item || !item.fixed) return;

  // 同月に既に定額積立済みかチェック
  const alreadyDone = item.history.find(h => h.month === selectedMonth && h.isFixed);
  if (alreadyDone) {
    showSnackbar(`${item.name}は今月すでに定額積立済みです`);
    return;
  }

  item.current += item.fixed;
  item.history.push({ month: selectedMonth, amount: item.fixed, isFixed: true });

  saveState();
  renderItems();
  renderDashboard();
  showSnackbar(`${escapeHtml(item.name)} に ${formatYen(item.fixed)} 積み立てました ✅`);
  checkRewards();

  const newRate = calcRate(item.current, item.goal);
  if (newRate >= 100) triggerCelebration(`${item.name} 完全達成！`, true);
  else if (newRate >= 80) triggerCelebration(`${item.name} 80% 達成！`, false);
}

/**
 * 一括積立 — 定額が設定された全項目を選択中の月にまとめて積み立てる
 * 同月に既に定額積立済みの項目はスキップする
 */
function applyAllFixed() {
  const targets = appState.items.filter(item => {
    if (!item.fixed || item.fixed <= 0) return false;
    // 同月の定額積立がまだの項目だけ対象
    return !item.history.find(h => h.month === selectedMonth && h.isFixed);
  });

  if (targets.length === 0) {
    showSnackbar('定額未設定、または今月すでに積立済みです');
    return;
  }

  let total = 0;
  targets.forEach(item => {
    item.current += item.fixed;
    item.history.push({ month: selectedMonth, amount: item.fixed, isFixed: true });
    total += item.fixed;
  });

  saveState();
  renderItems();
  renderDashboard();
  checkRewards();

  const [y, m] = selectedMonth.split('-').map(Number);
  showSnackbar(`${targets.length}件・合計 ${formatYen(total)} を一括積立しました 🎉`);
}

/**
 * 積立から出費を引く（例：食費の支払い、車検の引き落としなど）
 * マイナスの履歴エントリを追加し、current を減算する
 */
function useAmount() {
  const amount = parseInt(document.getElementById('detail-use-amount').value);
  const reason = document.getElementById('detail-use-reason').value.trim() || '使用';

  if (!amount || amount <= 0) {
    showSnackbar('正しい金額を入力してください');
    return;
  }

  const idx = appState.items.findIndex(i => i.id === currentItemId);
  if (idx === -1) return;

  const item = appState.items[idx];

  if (amount > item.current) {
    if (!confirm(`積立額（${formatYen(item.current)}）より多い金額です。続けますか？`)) return;
  }

  item.current = Math.max(0, item.current - amount);
  item.history.push({
    month:  selectedMonth,
    amount: -amount,
    note:   `💸${reason}`,
  });

  saveState();
  renderItems();
  renderDashboard();
  openDetailModal(currentItemId);
  showSnackbar(`${formatYen(amount)} を使用しました 💸`);
}

/**
 * 賞与・臨時収入をリセットする（入力ミス訂正用）
 * 選択中の月の bonus をゼロクリアして再入力できるようにする
 */
function resetBonus() {
  const [y, m] = selectedMonth.split('-').map(Number);
  if (!confirm(`${y}年${m}月の賞与・その他の収入をリセットしますか？`)) return;
  if (!appState.bonus) appState.bonus = {};
  delete appState.bonus[selectedMonth];
  document.getElementById('bonus-input').value = '';
  saveState();
  renderDashboard();
  showSnackbar('賞与・その他の収入をリセットしました');
}

/** 積立項目を削除 */
function deleteCurrentItem() {
  if (!confirm(`「${appState.items.find(i => i.id === currentItemId)?.name}」を削除しますか？`)) return;
  appState.items = appState.items.filter(i => i.id !== currentItemId);
  saveState();
  renderItems();
  renderDashboard();
  closeModal('modal-detail');
  showSnackbar('項目を削除しました');
}

// ============================================================
// ============================================================
// 再配分提案ロジック
// ============================================================
// 【アルゴリズム説明】
//  急な出費が発生したとき、以下のルールで各積立項目から
//  「削減可能な金額」を算出し、不足分を補う。
//
//  削減優先度（高い順に多く削減）:
//   1. 優先度「低」かつ期限まで余裕がある項目
//   2. 優先度「中」かつ期限まで余裕がある項目
//   3. 優先度「高」の項目（最終手段）
//
//  各項目から削減できる上限:
//   - 現在の積立額 × 削減率（優先度と期限に応じて変化）
//   - 削減後も月々積立額が0を下回らないよう調整
//
//  削減率テーブル（期限3ヶ月以内は1/2に抑える）:
//   - 低優先度: 50%（期限3ヶ月以内は25%）
//   - 中優先度: 30%（期限3ヶ月以内は15%）
//   - 高優先度: 10%（期限3ヶ月以内は5%）
// ============================================================

/** 再配分モーダルを開く */
function openRedistribModal() {
  document.getElementById('emergency-amount').value  = '';
  document.getElementById('emergency-reason').value  = '';
  document.getElementById('redistrib-result').style.display = 'none';
  pendingRedistrib = null;
  openModal('modal-redistrib');
}

/** 再配分を計算する */
function calculateRedistrib() {
  const emergency = parseInt(document.getElementById('emergency-amount').value);
  if (!emergency || emergency <= 0) {
    showSnackbar('出費金額を入力してください');
    return;
  }
  if (appState.items.length === 0) {
    showSnackbar('積立項目がありません');
    return;
  }

  // --- 削減率テーブル ---
  const REDUCTION_RATE = {
    low:  { normal: 0.50, nearDeadline: 0.25 },
    mid:  { normal: 0.30, nearDeadline: 0.15 },
    high: { normal: 0.10, nearDeadline: 0.05 },
  };
  const NEAR_DEADLINE_MONTHS = 3;

  // 各項目について削減可能額を計算
  let proposals = appState.items.map(item => {
    const months = monthsUntilDeadline(item.deadline);
    const isNear = months <= NEAR_DEADLINE_MONTHS;
    const rate   = REDUCTION_RATE[item.priority][isNear ? 'nearDeadline' : 'normal'];
    const maxCut = Math.floor(item.current * rate);

    return {
      id:         item.id,
      name:       item.name,
      priority:   item.priority,
      months,
      current:    item.current,
      maxCut,
      actualCut:  0, // 実際に削減する額（後で決定）
    };
  });

  // 削減優先順（低優先度・期限遠い → 高優先度・期限近い）
  proposals.sort((a, b) => {
    const pOrder = { low: 0, mid: 1, high: 2 };
    if (pOrder[a.priority] !== pOrder[b.priority]) {
      return pOrder[a.priority] - pOrder[b.priority];
    }
    return b.months - a.months; // 期限が遠い方を先に削減
  });

  // 必要額を満たすまで順番に削減
  let remaining = emergency;
  for (const p of proposals) {
    if (remaining <= 0) break;
    const cut     = Math.min(p.maxCut, remaining);
    p.actualCut   = cut;
    remaining    -= cut;
  }

  // 集計結果を表示
  pendingRedistrib = proposals;
  displayRedistribResult(proposals, emergency, remaining);
}

/** 再配分結果をモーダルに表示 */
function displayRedistribResult(proposals, emergency, shortfall) {
  const container = document.getElementById('redistrib-items');
  container.innerHTML = '';

  proposals.forEach(p => {
    const div = document.createElement('div');
    div.className = 'redistrib-item';

    let changeEl = '';
    if (p.actualCut > 0) {
      changeEl = `<span class="redistrib-change decrease">-${formatYen(p.actualCut)}</span>`;
    } else {
      changeEl = `<span class="redistrib-change same">変更なし</span>`;
    }

    div.innerHTML = `
      <span class="redistrib-name">${escapeHtml(p.name)}</span>
      <span style="font-size:12px; color:#7f8c9a; margin-right:8px;">残${p.months}ヶ月</span>
      ${changeEl}
    `;
    container.appendChild(div);
  });

  const totalCut = proposals.reduce((s, p) => s + p.actualCut, 0);
  const noteEl   = document.getElementById('redistrib-note');

  if (shortfall > 0) {
    noteEl.innerHTML = `⚠️ 積立項目から ${formatYen(totalCut)} を確保できましたが、<br>
      まだ <strong>${formatYen(shortfall)}</strong> が不足しています。<br>
      手持ち資金からの補填をご検討ください。`;
  } else {
    noteEl.innerHTML = `✅ 積立項目から合計 <strong>${formatYen(totalCut)}</strong> を確保できます。<br>
      各項目の積立額が上記の通り減額されます。`;
  }

  document.getElementById('redistrib-result').style.display = '';
}

/** 再配分を実際のデータに適用し、急な出費を履歴に記録する */
function applyRedistrib() {
  if (!pendingRedistrib) return;

  const emergencyAmount = parseInt(document.getElementById('emergency-amount').value) || 0;
  const emergencyReason = document.getElementById('emergency-reason').value.trim() || '急な出費';
  const cuts = [];

  pendingRedistrib.forEach(p => {
    if (p.actualCut <= 0) return;
    const item = appState.items.find(i => i.id === p.id);
    if (item) {
      item.current = Math.max(0, item.current - p.actualCut);
      // 各積立項目の履歴にマイナスエントリを追加（何月に・なぜ減ったか記録）
      item.history.push({
        month:  selectedMonth,
        amount: -p.actualCut,
        note:   `⚡${emergencyReason}`,
      });
      cuts.push({ name: p.name, cut: p.actualCut });
    }
  });

  // 急な出費全体を emergencies に記録
  if (!appState.emergencies) appState.emergencies = [];
  appState.emergencies.push({
    id:     generateId(),
    month:  selectedMonth,
    amount: emergencyAmount,
    reason: emergencyReason,
    date:   new Date().toLocaleDateString('ja-JP'),
    cuts,
  });

  saveState();
  renderItems();
  renderDashboard();
  renderEmergencyHistory();
  closeModal('modal-redistrib');
  showSnackbar('再配分を適用しました ✅');
  pendingRedistrib = null;
}

/**
 * 急な出費履歴をダッシュボードに描画する
 * selectedMonth に一致する履歴だけ表示し、全件は最新順で表示
 */
function renderEmergencyHistory() {
  const container = document.getElementById('emergency-history-list');
  if (!container) return;
  container.innerHTML = '';

  const list = (appState.emergencies || [])
    .filter(e => e.month === selectedMonth)
    .slice()
    .reverse();

  if (list.length === 0) {
    container.innerHTML = '<p style="font-size:13px; color:#7f8c9a; text-align:center; padding:8px 0;">この月の急な出費はありません</p>';
    return;
  }

  list.forEach(e => {
    const div = document.createElement('div');
    div.className = 'emergency-card';
    const cutsText = e.cuts.map(c => `${escapeHtml(c.name)}: -${formatYen(c.cut)}`).join(' / ');
    div.innerHTML = `
      <div class="e-header">
        <span>${escapeHtml(e.reason)}</span>
        <span>${e.date || e.month}</span>
      </div>
      <div class="e-amount">${formatYen(e.amount)}</div>
      <div class="e-cuts">${cutsText}</div>
      <button class="btn btn-danger" style="margin-top:8px; font-size:12px; min-height:34px; padding:6px 12px; width:100%;" onclick="deleteEmergency('${e.id}')">🗑️ 削除して積立を復元</button>
    `;
    container.appendChild(div);
  });
}

/** 急な出費を削除し、各項目の積立額を復元する */
function deleteEmergency(id) {
  const emergencies = appState.emergencies || [];
  const idx = emergencies.findIndex(e => e.id === id);
  if (idx === -1) return;

  const emergency = emergencies[idx];

  // 各項目の積立額とその月の履歴を復元
  emergency.cuts.forEach(cut => {
    const item = appState.items.find(i => i.name === cut.name);
    if (!item) return;
    item.current += cut.cut;
    // 同月・同額・同理由のマイナス履歴を1件削除
    for (let i = item.history.length - 1; i >= 0; i--) {
      const h = item.history[i];
      if (h.month === emergency.month && h.amount === -cut.cut && h.note && h.note.indexOf(emergency.reason) !== -1) {
        item.history.splice(i, 1);
        break;
      }
    }
  });

  appState.emergencies.splice(idx, 1);
  saveState();
  renderItems();
  renderDashboard();
  renderEmergencyHistory();
  showSnackbar('急な出費を削除し、積立額を復元しました ✅');
}

// ============================================================
// ============================================================
// ご褒美管理
// ============================================================
// 【ご褒美判定ロジック説明】
//  全積立項目の「平均達成率」を計算し、
//  各ご褒美の「必要達成率」と比較する。
//  平均達成率 >= 必要達成率 のご褒美が「達成済み」になる。
//
//  判定タイミング:
//   - 積立額を追加したとき
//   - 積立項目を保存したとき
//   - ページ読み込み時
//
//  達成時の処理:
//   - ご褒美の unlocked フラグを true にする
//   - お祝いアニメーションを表示する
//   - 一度達成したご褒美は状態が保持される
// ============================================================

/** ご褒美モーダルを開く */
function openAddRewardModal() {
  document.getElementById('reward-name').value     = '';
  document.getElementById('reward-icon').value     = '';
  document.getElementById('reward-rate').value     = '';
  document.getElementById('reward-category').value = 'food';
  openModal('modal-reward');
}

/** ご褒美を保存 */
function saveReward() {
  const name     = document.getElementById('reward-name').value.trim();
  const icon     = document.getElementById('reward-icon').value.trim() || '🎁';
  const rate     = parseInt(document.getElementById('reward-rate').value);
  const category = document.getElementById('reward-category').value;

  if (!name || !rate || rate < 1 || rate > 100) {
    showSnackbar('名前と達成率（1〜100%）を入力してください');
    return;
  }

  appState.rewards.push({
    id:       generateId(),
    name,
    icon,
    rate,
    category,
    unlocked: false,
  });

  saveState();
  renderRewards();
  closeModal('modal-reward');
  checkRewards();
  showSnackbar('ご褒美を追加しました 🎁');
}

/** ご褒美リストを描画 */
function renderRewards() {
  const container = document.getElementById('reward-list');
  const emptyEl   = document.getElementById('reward-empty');
  container.innerHTML = '';

  if (appState.rewards.length === 0) {
    emptyEl.style.display = '';
    return;
  }
  emptyEl.style.display = 'none';

  appState.rewards.forEach(reward => {
    const div = document.createElement('div');
    div.className = `reward-card ${reward.unlocked ? 'unlocked' : 'locked'}`;
    div.innerHTML = `
      <div class="reward-lock">${reward.unlocked ? '✅' : '🔒'}</div>
      <div class="reward-icon">${reward.icon}</div>
      <div class="reward-name">${escapeHtml(reward.name)}</div>
      <div class="reward-condition">達成率 ${reward.rate}% で解禁</div>
      ${reward.unlocked ? '<div style="font-size:11px; color:#2ecc71; font-weight:700; margin-top:4px;">達成済み！</div>' : ''}
    `;
    // 長押しで削除
    div.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (confirm(`「${reward.name}」を削除しますか？`)) {
        appState.rewards = appState.rewards.filter(r => r.id !== reward.id);
        saveState();
        renderRewards();
      }
    });
    container.appendChild(div);
  });
}

/**
 * ご褒美達成チェック
 * 全積立項目の平均達成率を計算し、未達成のご褒美を判定する
 */
function checkRewards() {
  if (appState.items.length === 0 || appState.rewards.length === 0) return;

  // 平均達成率を計算
  const avgRate = appState.items.reduce((sum, item) => {
    return sum + calcRate(item.current, item.goal);
  }, 0) / appState.items.length;

  let newlyUnlocked = [];

  appState.rewards.forEach(reward => {
    // 未達成のご褒美のみチェック
    if (!reward.unlocked && avgRate >= reward.rate) {
      reward.unlocked = true;
      newlyUnlocked.push(reward);
    }
  });

  if (newlyUnlocked.length > 0) {
    saveState();
    renderRewards();
    // 最初の達成ご褒美についてお祝い演出を発動
    const first = newlyUnlocked[0];
    triggerCelebration(`${first.icon} ご褒美解禁！「${first.name}」`, true);
  }
}

// ============================================================
// ============================================================
// お祝いアニメーション処理
// ============================================================
// 【アニメーション仕様説明】
//  1. キャラが画面中央にふわっと登場（scale 0.3 → 1）
//  2. ぴょんぴょんジャンプアニメーション（CSSアニメーション）
//  3. 背景に青い紙吹雪を Canvas で描画
//  4. 吹き出しが「ポワンッ」と出現（scale 0.6 → 1）
//  5. 吹き出し文字が1文字ずつフェードイン
//  6. 最後にキャラが手を振るアニメーション（CSSアニメーション）
// ============================================================

const CELEBRATION_MESSAGES = [
  'やったね！',
  'すごいよ！',
  '今日もがんばったね',
  'ご褒美タイムだよ！',
  'えらいっ！',
];

/** 紙吹雪パーティクルの配列 */
let confettiParticles = [];
let confettiAnimId    = null;

/**
 * お祝い演出を発動する
 * @param {string} message - 表示するメッセージ（吹き出し上部）
 * @param {boolean} isFullCelebration - 100%達成など最高演出かどうか
 */
function triggerCelebration(message, isFullCelebration) {
  const overlay   = document.getElementById('celebration-overlay');
  const charaImg  = document.getElementById('cel-chara-img');
  const charaEmoji= document.getElementById('cel-chara-emoji');
  const bubble    = document.getElementById('cel-bubble');

  // ランダムメッセージを選択
  const randMsg = CELEBRATION_MESSAGES[Math.floor(Math.random() * CELEBRATION_MESSAGES.length)];
  const fullMsg = message + '\n' + randMsg;

  // 応援キャラ画像の設定
  const charaBase64 = appState.charaImage;
  if (charaBase64) {
    charaImg.src = charaBase64;
    charaImg.style.display = '';
    charaEmoji.style.display = 'none';
  } else {
    charaImg.style.display = 'none';
    charaEmoji.style.display = '';
  }

  // オーバーレイを表示
  overlay.classList.add('show');

  // キャラ登場アニメーション（少し遅延）
  const activeChara = charaBase64 ? charaImg : charaEmoji;
  activeChara.classList.remove('appear', 'jumping', 'waving');
  setTimeout(() => {
    activeChara.classList.add('appear');
    // ジャンプ開始
    setTimeout(() => activeChara.classList.add('jumping'), 500);
  }, 100);

  // 吹き出しアニメーション
  bubble.classList.remove('appear');
  bubble.innerHTML = '';
  setTimeout(() => {
    bubble.classList.add('appear');
    // 1文字ずつアニメーション
    animateTextChar(bubble, fullMsg, 0);
  }, 600);

  // 紙吹雪開始
  startConfetti(isFullCelebration ? 200 : 80);

  // 最後に手を振るアニメーション（3秒後）
  setTimeout(() => {
    activeChara.classList.remove('jumping');
    activeChara.classList.add('waving');
  }, 3000);
}

/**
 * 吹き出しメッセージを1文字ずつアニメーション表示
 * @param {HTMLElement} el - テキストを追加する要素
 * @param {string} text    - 表示するテキスト
 * @param {number} index   - 現在の文字インデックス
 */
function animateTextChar(el, text, index) {
  if (index >= text.length) return;

  const char = text[index];
  if (char === '\n') {
    el.appendChild(document.createElement('br'));
  } else {
    const span = document.createElement('span');
    span.textContent = char;
    span.style.animationDelay = `${index * 0.05}s`;
    el.appendChild(span);
  }
  setTimeout(() => animateTextChar(el, text, index + 1), 60);
}

/** お祝い演出を閉じる */
function closeCelebration() {
  const overlay = document.getElementById('celebration-overlay');
  overlay.classList.remove('show');

  // キャラのクラスをリセット
  document.getElementById('cel-chara-img').classList.remove('appear', 'jumping', 'waving');
  document.getElementById('cel-chara-emoji').classList.remove('appear', 'jumping', 'waving');
  document.getElementById('cel-bubble').classList.remove('appear');

  // 紙吹雪停止
  stopConfetti();
}

// ============================================================
// 紙吹雪（Canvas描画）
// ============================================================

/**
 * 紙吹雪を開始する
 * @param {number} count - パーティクル数
 */
function startConfetti(count) {
  const canvas = document.getElementById('confetti-canvas');
  const ctx    = canvas.getContext('2d');

  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;

  // パーティクルを生成（青系のカラーパレット）
  const colors = ['#4f7cff', '#7b9fff', '#a5c0ff', '#ffffff', '#b3d9ff', '#3560e0', '#64b5f6'];
  confettiParticles = Array.from({ length: count }, () => ({
    x:      Math.random() * canvas.width,
    y:      Math.random() * canvas.height - canvas.height,
    w:      Math.random() * 10 + 5,
    h:      Math.random() * 6 + 3,
    color:  colors[Math.floor(Math.random() * colors.length)],
    speed:  Math.random() * 3 + 1,
    angle:  Math.random() * Math.PI * 2,
    spin:   (Math.random() - 0.5) * 0.2,
    drift:  (Math.random() - 0.5) * 2,
  }));

  if (confettiAnimId) cancelAnimationFrame(confettiAnimId);
  drawConfetti(ctx, canvas);
}

/** 紙吹雪を1フレーム描画してアニメーションループ */
function drawConfetti(ctx, canvas) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  confettiParticles.forEach(p => {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    ctx.restore();

    // 位置更新
    p.y     += p.speed;
    p.x     += p.drift;
    p.angle += p.spin;

    // 画面外に出たら上から再登場
    if (p.y > canvas.height) {
      p.y = -10;
      p.x = Math.random() * canvas.width;
    }
  });

  confettiAnimId = requestAnimationFrame(() => drawConfetti(ctx, canvas));
}

/** 紙吹雪を停止する */
function stopConfetti() {
  if (confettiAnimId) {
    cancelAnimationFrame(confettiAnimId);
    confettiAnimId = null;
  }
  const canvas = document.getElementById('confetti-canvas');
  const ctx    = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  confettiParticles = [];
}

// ============================================================
// 応援キャラ画像管理
// ============================================================

/** 画像ファイルをアップロードして base64 で localStorage に保存 */
function uploadCharaImage(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    appState.charaImage = e.target.result;
    saveState();
    loadCharaImage();
    showSnackbar('キャラ画像を設定しました 🐾');
  };
  reader.readAsDataURL(file);
}

/** 保存済みのキャラ画像を画面に反映する */
function loadCharaImage() {
  const preview     = document.getElementById('chara-preview');
  const placeholder = document.getElementById('chara-placeholder');

  if (appState.charaImage) {
    preview.src            = appState.charaImage;
    preview.style.display  = '';
    placeholder.style.display = 'none';
  } else {
    preview.style.display     = 'none';
    placeholder.style.display = '';
  }
}

/** キャラ画像を削除 */
function removeCharaImage() {
  if (!confirm('応援キャラ画像を削除しますか？')) return;
  appState.charaImage = null;
  saveState();
  loadCharaImage();
  showSnackbar('キャラ画像を削除しました');
}

// ============================================================
// ============================================================
// グラフ描画（Chart.js）
// ============================================================
// 【グラフ種別説明】
//  1. 折れ線グラフ: 月ごとの積立履歴を項目別に可視化
//     - x軸: 過去12ヶ月の年月
//     - y軸: 各月の積立額
//  2. 円グラフ: 全項目の現在積立額の割合を表示
//  3. 棒グラフ: 各項目の達成率（%）を横並びで比較
// ============================================================

/** 現在表示中のグラフタブ */
let currentGraphTab = 'line';

/** グラフタブを切り替える */
function switchGraphTab(tab, btnEl) {
  currentGraphTab = tab;

  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btnEl.classList.add('active');

  document.getElementById('graph-line').style.display = tab === 'line' ? '' : 'none';
  document.getElementById('graph-pie').style.display  = tab === 'pie'  ? '' : 'none';
  document.getElementById('graph-bar').style.display  = tab === 'bar'  ? '' : 'none';

  renderCharts();
}

/** アクティブなグラフを描画（または再描画） */
function renderCharts() {
  if (currentGraphTab === 'line') renderLineChart();
  if (currentGraphTab === 'pie')  renderPieChart();
  if (currentGraphTab === 'bar')  renderBarChart();
}

/** 過去12ヶ月のラベルを生成 */
function getLast12Months() {
  const result = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    result.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return result;
}

/** グラフ用カラーパレット */
const CHART_COLORS = [
  '#4f7cff', '#ff6b9d', '#2ecc71', '#f39c12',
  '#9b59b6', '#3498db', '#e74c3c', '#1abc9c',
];

/**
 * 折れ線グラフを描画（月ごとの積立推移）
 */
function renderLineChart() {
  const ctx    = document.getElementById('chart-line').getContext('2d');
  const months = getLast12Months();

  // 各項目の月別積立額データセットを作成
  const datasets = appState.items.map((item, i) => {
    const data = months.map(month => {
      const h = (item.history || []).find(h => h.month === month);
      return h ? h.amount : 0;
    });
    return {
      label:           item.name,
      data,
      borderColor:     CHART_COLORS[i % CHART_COLORS.length],
      backgroundColor: CHART_COLORS[i % CHART_COLORS.length] + '20',
      borderWidth:     2,
      tension:         0.4,
      fill:            false,
      pointRadius:     4,
    };
  });

  // 既存チャートを破棄して再作成
  if (chartLine) chartLine.destroy();
  chartLine = new Chart(ctx, {
    type: 'line',
    data: {
      labels: months.map(m => m.slice(5) + '月'),
      datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: (v) => formatYen(v),
            font: { size: 10 },
          },
        },
        x: { ticks: { font: { size: 10 } } },
      },
    },
  });
}

/**
 * 円グラフを描画（項目別積立割合）
 */
function renderPieChart() {
  const ctx = document.getElementById('chart-pie').getContext('2d');

  const labels = appState.items.map(i => i.name);
  const data   = appState.items.map(i => i.current);

  if (chartPie) chartPie.destroy();
  chartPie = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: CHART_COLORS.map(c => c + 'cc'),
        borderColor:     '#fff',
        borderWidth:     2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.label}: ${formatYen(ctx.raw)}`,
          },
        },
      },
    },
  });
}

/**
 * 棒グラフを描画（項目別達成率）
 */
function renderBarChart() {
  const ctx = document.getElementById('chart-bar').getContext('2d');

  const labels = appState.items.map(i => i.name);
  const data   = appState.items.map(i => calcRate(i.current, i.goal));

  // 達成率に応じて色を変える
  const bgColors = data.map(r => {
    if (r >= 100) return '#2ecc71cc';
    if (r >= 60)  return '#4f7cffcc';
    if (r >= 30)  return '#f39c12cc';
    return             '#e74c3ccc';
  });

  if (chartBar) chartBar.destroy();
  chartBar = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: '達成率 (%)',
        data,
        backgroundColor: bgColors,
        borderRadius:    6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',  // 横棒グラフにする（項目名が長い場合に読みやすい）
      plugins: {
        legend: { display: false },
      },
      scales: {
        x: {
          min: 0,
          max: 100,
          ticks: {
            callback: (v) => v + '%',
            font: { size: 10 },
          },
        },
        y: { ticks: { font: { size: 11 } } },
      },
    },
  });
}

// ============================================================
// モーダル制御
// ============================================================

function openModal(id) {
  document.getElementById(id).classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  document.body.style.overflow = '';
}

/** オーバーレイ（背景）クリックでモーダルを閉じる */
function closeModalOnOverlay(event, id) {
  if (event.target === document.getElementById(id)) {
    closeModal(id);
  }
}

// ============================================================
// スナックバー（トースト通知）
// ============================================================

let snackbarTimer = null;

/** スナックバーを表示する */
function showSnackbar(message) {
  const el = document.getElementById('snackbar');
  el.textContent = message;
  el.classList.add('show');

  if (snackbarTimer) clearTimeout(snackbarTimer);
  snackbarTimer = setTimeout(() => {
    el.classList.remove('show');
  }, 2500);
}

// ============================================================
// データエクスポート・インポート
// ============================================================

/** アプリデータをJSONファイルとしてダウンロード */
function exportData() {
  const json = JSON.stringify(appState, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `kakeibo_backup_${getCurrentMonth()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showSnackbar('データをエクスポートしました 📤');
}

/** JSONファイルからデータを読み込んで復元 */
function importData(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.items || !data.income) {
        showSnackbar('ファイル形式が正しくありません');
        return;
      }
      if (!confirm('現在のデータを上書きしてインポートしますか？')) return;
      appState = { ...appState, ...data };
      saveState();
      renderItems();
      renderDashboard();
      renderRewards();
      loadCharaImage();
      showSnackbar('データをインポートしました 📥');
    } catch {
      showSnackbar('ファイルの読み込みに失敗しました');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

/** 全データを削除して初期化 */
function confirmResetData() {
  if (!confirm('全データを削除します。この操作は元に戻せません。よろしいですか？')) return;
  appState = { income: {}, items: [], rewards: [], charaImage: null };
  saveState();
  renderItems();
  renderDashboard();
  renderRewards();
  loadCharaImage();
  showSnackbar('データを削除しました 🗑️');
}
