// ===== Supabase 設定 =====
const SUPABASE_URL = '這裡貼你的 Project URL';
const SUPABASE_PUBLISHABLE_KEY = '這裡貼你的 Publishable Key';

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);// ---------- 資料儲存 ----------
const STORAGE_KEY = 'wishBudgetData_v1';

const CATEGORIES = {
  income: ['固定薪資', '斜槓收入', '投資收入', '天使撒錢'],
  expense: ['外食', '食材', '衣服', '房貸/租', '管理費', '維修費', '油錢', '過路費', '停車費', '教育費', '娛樂', '美容']
};

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore corrupt data */ }
  return { transactions: [], wishes: [] };
}

function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) { console.error('儲存失敗', e); }
}

const state = loadData();

// ---------- 工具函式 ----------
function fmtMoney(n) {
  return '$' + Math.round(n).toLocaleString('zh-Hant');
}

function monthKey(dateStr) {
  return dateStr.slice(0, 7); // YYYY-MM
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function monthLabel(key) {
  const [y, m] = key.split('-');
  return `${y}年${parseInt(m)}月`;
}

function addMonths(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ---------- Tab 切換 ----------
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'analysis') renderAnalysis();
    if (btn.dataset.tab === 'wishlist') renderWishes();
    if (btn.dataset.tab === 'qa') initQA();
  });
});

// ================= 記帳頁 =================
let currentMonth = monthKey(todayStr());

const txForm = document.getElementById('txForm');
const txCategory = document.getElementById('txCategory');
const txDate = document.getElementById('txDate');

function populateCategories() {
  const type = document.querySelector('input[name="txType"]:checked').value;
  txCategory.innerHTML = CATEGORIES[type].map(c => `<option value="${c}">${c}</option>`).join('');
}
document.querySelectorAll('input[name="txType"]').forEach(r => r.addEventListener('change', populateCategories));
populateCategories();
txDate.value = todayStr();

document.getElementById('prevMonth').addEventListener('click', () => {
  currentMonth = addMonths(currentMonth, -1);
  renderLedger();
});
document.getElementById('nextMonth').addEventListener('click', () => {
  currentMonth = addMonths(currentMonth, 1);
  renderLedger();
});

txForm.addEventListener('submit', e => {
  e.preventDefault();
  const type = document.querySelector('input[name="txType"]:checked').value;
  const amount = parseFloat(document.getElementById('txAmount').value);
  if (!amount || amount <= 0) return;
  state.transactions.push({
    id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    type,
    category: txCategory.value,
    amount,
    date: txDate.value,
    note: document.getElementById('txNote').value.trim()
  });
  saveData();
  currentMonth = monthKey(txDate.value);
  document.getElementById('txAmount').value = '';
  document.getElementById('txNote').value = '';
  txDate.value = todayStr();
  renderLedger();
});

function deleteTx(id) {
  state.transactions = state.transactions.filter(t => t.id !== id);
  saveData();
  renderLedger();
}

function renderLedger() {
  document.getElementById('monthLabel').textContent = monthLabel(currentMonth);
  const monthTx = state.transactions.filter(t => monthKey(t.date) === currentMonth);

  const income = monthTx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expense = monthTx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  document.getElementById('sumIncome').textContent = fmtMoney(income);
  document.getElementById('sumExpense').textContent = fmtMoney(expense);
  document.getElementById('sumBalance').textContent = fmtMoney(income - expense);

  const list = document.getElementById('txList');
  const sorted = [...monthTx].sort((a, b) => b.date.localeCompare(a.date));
  if (sorted.length === 0) {
    list.innerHTML = '<li class="empty-hint">這個月還沒有紀錄，開始新增吧！</li>';
    return;
  }
  list.innerHTML = sorted.map(t => `
    <li class="tx-item">
      <div class="tx-info">
        <span class="tx-cat">${t.category}</span>
        <span class="tx-meta">${t.date}${t.note ? ' · ' + escapeHtml(t.note) : ''}</span>
      </div>
      <span class="tx-amount ${t.type}">${t.type === 'income' ? '+' : '-'}${fmtMoney(t.amount)}</span>
      <button class="tx-del" data-id="${t.id}">✕</button>
    </li>
  `).join('');
  list.querySelectorAll('.tx-del').forEach(btn => {
    btn.addEventListener('click', () => deleteTx(btn.dataset.id));
  });
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ================= 消費分析頁 =================
let pieChart = null, trendChart = null;
document.getElementById('rangeSelect').addEventListener('change', renderAnalysis);

function getAllMonthsSorted() {
  const set = new Set(state.transactions.map(t => monthKey(t.date)));
  return [...set].sort();
}

function renderAnalysis() {
  const range = document.getElementById('rangeSelect').value;
  const allMonths = getAllMonthsSorted();
  let months;
  if (range === 'all') {
    months = allMonths;
  } else {
    const n = parseInt(range);
    // build last n months ending at currentMonth even if empty, so trend line is continuous
    months = [];
    for (let i = n - 1; i >= 0; i--) months.push(addMonths(currentMonth, -i));
  }
  const monthSet = new Set(months);
  const tx = state.transactions.filter(t => monthSet.has(monthKey(t.date)));

  const totalIncome = tx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const totalExpense = tx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  document.getElementById('anIncome').textContent = fmtMoney(totalIncome);
  document.getElementById('anExpense').textContent = fmtMoney(totalExpense);
  const savingRate = totalIncome > 0 ? Math.round(((totalIncome - totalExpense) / totalIncome) * 100) : 0;
  document.getElementById('anSavingRate').textContent = savingRate + '%';

  // 支出分類佔比
  const catTotals = {};
  CATEGORIES.expense.forEach(c => catTotals[c] = 0);
  tx.filter(t => t.type === 'expense').forEach(t => { catTotals[t.category] = (catTotals[t.category] || 0) + t.amount; });
  const catLabels = Object.keys(catTotals).filter(c => catTotals[c] > 0);
  const catValues = catLabels.map(c => catTotals[c]);

  const pieCtx = document.getElementById('expensePie');
  if (pieChart) pieChart.destroy();
  if (catLabels.length === 0) {
    pieCtx.getContext('2d').clearRect(0, 0, pieCtx.width, pieCtx.height);
  } else {
    pieChart = new Chart(pieCtx, {
      type: 'doughnut',
      data: {
        labels: catLabels,
        datasets: [{
          data: catValues,
          backgroundColor: palette(catLabels.length)
        }]
      },
      options: { plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } } }
    });
  }

  // 收支趨勢
  const trendMonths = months.length ? months : allMonths;
  const incomeSeries = trendMonths.map(m => tx.filter(t => t.type === 'income' && monthKey(t.date) === m).reduce((s, t) => s + t.amount, 0));
  const expenseSeries = trendMonths.map(m => tx.filter(t => t.type === 'expense' && monthKey(t.date) === m).reduce((s, t) => s + t.amount, 0));

  const trendCtx = document.getElementById('trendChart');
  if (trendChart) trendChart.destroy();
  trendChart = new Chart(trendCtx, {
    type: 'line',
    data: {
      labels: trendMonths.map(m => m.slice(5) + '月'),
      datasets: [
        { label: '收入', data: incomeSeries, borderColor: '#4a8c6f', backgroundColor: 'transparent', tension: 0.3 },
        { label: '支出', data: expenseSeries, borderColor: '#c0604f', backgroundColor: 'transparent', tension: 0.3 }
      ]
    },
    options: { scales: { y: { beginAtZero: true } }, plugins: { legend: { position: 'bottom' } } }
  });

  renderInsights(tx, catTotals, totalIncome, totalExpense, savingRate, trendMonths, incomeSeries, expenseSeries);
}

function palette(n) {
  const base = ['#c9a25c', '#4a8c6f', '#c0604f', '#5b7ea6', '#9a6fb0', '#d4a017', '#6f9a7e', '#b0715b', '#7a7ecf', '#a3a35c', '#c78fa0', '#5a9bb0'];
  const out = [];
  for (let i = 0; i < n; i++) out.push(base[i % base.length]);
  return out;
}

function renderInsights(tx, catTotals, totalIncome, totalExpense, savingRate, months, incomeSeries, expenseSeries) {
  const box = document.getElementById('insights');
  const items = [];

  if (tx.length === 0) {
    box.innerHTML = '<div class="empty-hint">目前資料不足以分析，先去記帳頁新增幾筆紀錄吧！</div>';
    return;
  }

  const sortedCats = Object.entries(catTotals).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (sortedCats.length > 0) {
    const [topCat, topVal] = sortedCats[0];
    const pct = totalExpense > 0 ? Math.round((topVal / totalExpense) * 100) : 0;
    items.push(`📌 最大支出類別是「${topCat}」，共 ${fmtMoney(topVal)}，佔總支出的 ${pct}%。`);
  }
  if (sortedCats.length > 1) {
    const top3 = sortedCats.slice(0, 3).map(([c, v]) => `${c} ${fmtMoney(v)}`).join('、');
    items.push(`🏷 前三大支出類別：${top3}。`);
  }

  items.push(savingRate >= 20
    ? `✅ 儲蓄率為 ${savingRate}%，表現不錯，持續保持！`
    : savingRate >= 0
      ? `⚠️ 儲蓄率僅 ${savingRate}%，可以檢視「外食」「娛樂」等彈性支出是否有節省空間。`
      : `🚨 這段期間支出超過收入（儲蓄率 ${savingRate}%），建議優先檢查固定支出與非必要花費。`);

  // 月對月比較（若有至少 2 個月資料）
  const nonZeroIdx = expenseSeries.map((v, i) => ({ v, i })).filter(o => o.v > 0);
  if (nonZeroIdx.length >= 2) {
    const lastIdx = nonZeroIdx[nonZeroIdx.length - 1].i;
    const prevIdx = nonZeroIdx[nonZeroIdx.length - 2].i;
    const diff = expenseSeries[lastIdx] - expenseSeries[prevIdx];
    if (Math.abs(diff) > 0.01) {
      const pct = Math.round((diff / expenseSeries[prevIdx]) * 100);
      items.push(diff > 0
        ? `📈 ${months[lastIdx].slice(5)}月支出比${months[prevIdx].slice(5)}月增加了 ${fmtMoney(Math.abs(diff))}（+${pct}%）。`
        : `📉 ${months[lastIdx].slice(5)}月支出比${months[prevIdx].slice(5)}月減少了 ${fmtMoney(Math.abs(diff))}（${pct}%）。`);
    }
  }

  const eatOut = catTotals['外食'] || 0;
  const groceries = catTotals['食材'] || 0;
  if (eatOut > 0 && groceries > 0 && eatOut > groceries * 1.5) {
    items.push(`🍽 外食支出（${fmtMoney(eatOut)}）明顯高於食材支出（${fmtMoney(groceries)}），增加自煮比例有機會省下不少錢。`);
  }

  box.innerHTML = items.map(t => `<div class="insight-item">${t}</div>`).join('');
}

// ================= 心願清單頁 =================
const wishForm = document.getElementById('wishForm');
document.getElementById('wishDate').min = todayStr();

wishForm.addEventListener('submit', e => {
  e.preventDefault();
  const name = document.getElementById('wishName').value.trim();
  const targetDate = document.getElementById('wishDate').value;
  const cost = parseFloat(document.getElementById('wishCost').value);
  if (!name || !targetDate || !cost || cost <= 0) return;
  state.wishes.push({
    id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    name, targetDate, cost, createdDate: todayStr()
  });
  saveData();
  wishForm.reset();
  document.getElementById('wishDate').min = todayStr();
  renderWishes();
});

function deleteWish(id) {
  state.wishes = state.wishes.filter(w => w.id !== id);
  saveData();
  renderWishes();
}

function timeRemaining(targetDate) {
  const now = new Date();
  const target = new Date(targetDate + 'T00:00:00');
  let diffDays = Math.ceil((target - now) / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return { expired: true, days: 0, months: 0, text: '已到期' };
  const years = Math.floor(diffDays / 365);
  const remAfterYears = diffDays % 365;
  const months = Math.floor(remAfterYears / 30);
  const days = remAfterYears % 30;
  let text = '';
  if (years > 0) text += `${years}年`;
  if (months > 0 || years > 0) text += `${months}個月`;
  text += `${days}天`;
  const totalMonths = Math.max(1, Math.ceil(diffDays / 30));
  return { expired: false, days: diffDays, months: totalMonths, text };
}

function avgMonthlySurplus() {
  const months = getAllMonthsSorted();
  if (months.length === 0) return null;
  const recent = months.slice(-6);
  let totalIncome = 0, totalExpense = 0;
  recent.forEach(m => {
    state.transactions.forEach(t => {
      if (monthKey(t.date) !== m) return;
      if (t.type === 'income') totalIncome += t.amount; else totalExpense += t.amount;
    });
  });
  return (totalIncome - totalExpense) / recent.length;
}

function investmentSuggestions(months) {
  if (months <= 12) {
    return {
      tier: '短期目標（12個月內）· 重點：保本與資金靈活度',
      items: [
        '<b>高利活存數位帳戶</b>：如聯邦New New Bank、樂天銀行、王道O-Bank等，新戶優惠利率曾達8%~15%（需留意額度與期限限制），資金隨時可動用，適合確定日期要花用的目標。',
        '<b>銀行定期存款</b>：鎖定與目標時間相近的存款期別，利率通常優於活存，適合已確定支出時間點的心願。',
        '<b>貨幣市場基金</b>：波動極低、可隨時申贖，適合作為短期資金的停泊工具。'
      ]
    };
  } else if (months <= 36) {
    return {
      tier: '中期目標（1~3年）· 重點：兼顧穩定與小幅成長',
      items: [
        '<b>債券ETF定期定額</b>（如00679B、00687B等）：波動低於股票型ETF，適合中期資金停泊。',
        '<b>高股息ETF定期定額</b>（如0056、00878、00929）：定期配息可滾入目標存款，加速累積速度。',
        '<b>股債平衡型ETF</b>：以債券緩衝股票波動，降低目標達成前資金大幅縮水的風險。'
      ]
    };
  } else {
    return {
      tier: '長期目標（3年以上）· 重點：追求資產成長',
      items: [
        '<b>市值型ETF定期定額</b>（如0050元大台灣50、006208富邦台50）：長期追蹤台灣加權指數，台股長期年化報酬約7%~10%（含配息再投入），是目前定期定額人氣最高的核心標的。',
        '<b>高股息ETF搭配市值型ETF</b>（如00929、00878 + 0050）：兼顧現金流與資產成長，分散單一策略風險。',
        '<b>全球型大盤ETF或基金</b>：分散在台股以外的市場，降低單一市場的長期波動風險。'
      ]
    };
  }
}

function renderWishes() {
  const box = document.getElementById('wishList');
  if (state.wishes.length === 0) {
    box.innerHTML = '<div class="empty-hint">還沒有心願，新增一個開始規劃吧！</div>';
    return;
  }
  const surplus = avgMonthlySurplus();
  const sorted = [...state.wishes].sort((a, b) => a.targetDate.localeCompare(b.targetDate));

  box.innerHTML = sorted.map(w => {
    const rem = timeRemaining(w.targetDate);
    const monthlyNeeded = rem.expired ? w.cost : w.cost / rem.months;
    const suggestion = investmentSuggestions(rem.expired ? 1 : rem.months);
    const surplusNote = surplus === null
      ? '尚無記帳資料，無法比較目前平均結餘。'
      : surplus >= monthlyNeeded
        ? `目前近6個月平均每月結餘約 ${fmtMoney(surplus)}，已高於目標所需，持續保持即可達成！`
        : `目前近6個月平均每月結餘約 ${fmtMoney(surplus)}，距離每月所需仍差 ${fmtMoney(monthlyNeeded - surplus)}，可考慮增加收入或減少支出。`;

    return `
      <div class="wish-card">
        <div class="wish-head">
          <div>
            <div class="wish-title">🎯 ${escapeHtml(w.name)}</div>
            <div class="wish-target">預計達成時間：${w.targetDate}</div>
          </div>
          <button class="wish-del" data-id="${w.id}">✕</button>
        </div>
        <div class="wish-stats">
          <div class="wish-stat"><span class="label">距離目標</span><span class="value">${rem.text}</span></div>
          <div class="wish-stat"><span class="label">預估支出</span><span class="value">${fmtMoney(w.cost)}</span></div>
          <div class="wish-stat"><span class="label">每月需存</span><span class="value">${fmtMoney(monthlyNeeded)}</span></div>
          <div class="wish-stat"><span class="label">剩餘月數</span><span class="value">${rem.expired ? '已到期' : rem.months + ' 個月'}</span></div>
        </div>
        <div class="wish-note">${surplusNote}</div>
        <div class="invest-box">
          <h4>💡 ${suggestion.tier}</h4>
          <ol>${suggestion.items.map(i => `<li>${i}</li>`).join('')}</ol>
          <div class="invest-disclaimer">資料整理於2026年9月，市場利率與商品持續變動，僅供參考，非投資建議，實際投資前請自行評估風險。</div>
        </div>
      </div>
    `;
  }).join('');

  box.querySelectorAll('.wish-del').forEach(btn => {
    btn.addEventListener('click', () => deleteWish(btn.dataset.id));
  });
}

// ================= 投資問答 =================
const API_KEY_STORAGE = 'wishBudget_anthropicKey_v1';
const CHAT_STORAGE = 'wishBudget_chatHistory_v1';
const QA_MODEL = 'claude-sonnet-5';

let chatHistory = [];
try {
  const raw = localStorage.getItem(CHAT_STORAGE);
  if (raw) chatHistory = JSON.parse(raw);
} catch (e) { chatHistory = []; }

function saveChatHistory() {
  try { localStorage.setItem(CHAT_STORAGE, JSON.stringify(chatHistory)); } catch (e) { /* ignore */ }
}

function getApiKey() {
  try { return localStorage.getItem(API_KEY_STORAGE) || ''; } catch (e) { return ''; }
}

function setApiKey(key) {
  try { localStorage.setItem(API_KEY_STORAGE, key); } catch (e) { /* ignore */ }
}

function clearApiKey() {
  try { localStorage.removeItem(API_KEY_STORAGE); } catch (e) { /* ignore */ }
}

const apiKeySetup = document.getElementById('apiKeySetup');
const qaMain = document.getElementById('qaMain');
const apiKeyInput = document.getElementById('apiKeyInput');
const chatMessagesBox = document.getElementById('chatMessages');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');

function initQA() {
  const key = getApiKey();
  if (key) {
    apiKeySetup.hidden = true;
    qaMain.hidden = false;
    renderChatMessages();
  } else {
    apiKeySetup.hidden = false;
    qaMain.hidden = true;
  }
}

document.getElementById('saveApiKey').addEventListener('click', () => {
  const key = apiKeyInput.value.trim();
  if (!key) return;
  setApiKey(key);
  apiKeyInput.value = '';
  initQA();
});

document.getElementById('changeApiKey').addEventListener('click', () => {
  clearApiKey();
  initQA();
});

document.getElementById('clearChat').addEventListener('click', () => {
  chatHistory = [];
  saveChatHistory();
  renderChatMessages();
});

function renderChatMessages() {
  if (chatHistory.length === 0) {
    chatMessagesBox.innerHTML = '<div class="empty-hint small">你可以問我任何跟投資、存錢配置有關的問題，例如：「我每月能存多少錢才能達成心願清單裡的目標？」</div>';
    return;
  }
  chatMessagesBox.innerHTML = chatHistory.map(m =>
    `<div class="chat-msg ${m.role === 'user' ? 'user' : 'assistant'}">${escapeHtml(m.content)}</div>`
  ).join('');
  chatMessagesBox.scrollTop = chatMessagesBox.scrollHeight;
}

function buildFinancialContext() {
  const months = getAllMonthsSorted();
  if (months.length === 0 && state.wishes.length === 0) return '（使用者目前尚未記錄任何收支或心願資料。）';

  const recent = months.slice(-6);
  let totalIncome = 0, totalExpense = 0;
  const catTotals = {};
  recent.forEach(m => {
    state.transactions.forEach(t => {
      if (monthKey(t.date) !== m) return;
      if (t.type === 'income') totalIncome += t.amount;
      else { totalExpense += t.amount; catTotals[t.category] = (catTotals[t.category] || 0) + t.amount; }
    });
  });
  const avgIncome = recent.length ? totalIncome / recent.length : 0;
  const avgExpense = recent.length ? totalExpense / recent.length : 0;
  const avgSurplus = avgIncome - avgExpense;
  const topCats = Object.entries(catTotals).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([c, v]) => `${c} $${Math.round(v)}`).join('、') || '無';

  const wishLines = state.wishes.map(w => {
    const rem = timeRemaining(w.targetDate);
    const monthlyNeeded = rem.expired ? w.cost : w.cost / rem.months;
    return `- ${w.name}：目標日期 ${w.targetDate}，預估支出 $${w.cost}，剩餘約 ${rem.text}，每月需存約 $${Math.round(monthlyNeeded)}`;
  }).join('\n') || '（目前沒有心願清單項目）';

  return `以下是使用者近6個月的財務摘要（供回答時參考，非必要不用逐項複述）：
近6個月平均每月收入：約 $${Math.round(avgIncome)}
近6個月平均每月支出：約 $${Math.round(avgExpense)}
近6個月平均每月結餘：約 $${Math.round(avgSurplus)}
近6個月支出前五大類別：${topCats}

心願清單：
${wishLines}`;
}

function buildSystemPrompt(useContext) {
  let prompt = `你是「心願預算本」網站內建的投資理財問答助理，使用繁體中文（台灣用語）回答問題。使用者是一般個人理財使用者，會詢問跟存錢、記帳習慣、投資工具（如ETF、數位帳戶、債券、基金等）相關的問題，特別是如何規劃每月存款以達成心願清單上的目標。

回答原則：
- 簡潔實用，避免過長的免責聲明重複出現，但可在必要時提醒「非正式投資建議」。
- 若使用者提供財務數字，可直接幫忙試算（例如每月需存多少、幾年可達成）。
- 提到具體投資工具時，簡單說明其風險特性（保守/中等/積極），不要保證報酬率。
- 你不是持牌理財顧問，不做個股報明牌、不做確定性的獲利承諾。
- 回答用一般口語、條列式，不要用 Markdown 標題語法。`;
  if (useContext) {
    prompt += `\n\n${buildFinancialContext()}`;
  }
  return prompt;
}

async function callClaudeAPI(userMessage, useContext) {
  const apiKey = getApiKey();
  const messages = chatHistory
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({ role: m.role, content: m.content }));
  messages.push({ role: 'user', content: userMessage });

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: QA_MODEL,
      max_tokens: 1024,
      system: buildSystemPrompt(useContext),
      messages
    })
  });

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error?.message || ''; } catch (e) { /* ignore */ }
    throw new Error(`API 請求失敗 (${res.status})${detail ? '：' + detail : ''}`);
  }
  const data = await res.json();
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  return text || '（沒有收到回應內容）';
}

chatForm.addEventListener('submit', async e => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  const useContext = document.getElementById('useContextToggle').checked;

  chatHistory.push({ role: 'user', content: text });
  saveChatHistory();
  renderChatMessages();
  chatInput.value = '';
  sendBtn.disabled = true;

  const pending = document.createElement('div');
  pending.className = 'chat-msg assistant pending';
  pending.textContent = '思考中…';
  chatMessagesBox.appendChild(pending);
  chatMessagesBox.scrollTop = chatMessagesBox.scrollHeight;

  try {
    const reply = await callClaudeAPI(text, useContext);
    chatHistory.push({ role: 'assistant', content: reply });
    saveChatHistory();
    renderChatMessages();
  } catch (err) {
    pending.remove();
    const errBox = document.createElement('div');
    errBox.className = 'chat-msg error';
    errBox.textContent = '❌ ' + (err.message || '發生未知錯誤，請確認 API Key 是否正確或稍後再試。');
    chatMessagesBox.appendChild(errBox);
    chatMessagesBox.scrollTop = chatMessagesBox.scrollHeight;
  } finally {
    sendBtn.disabled = false;
  }
});

chatInput?.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    chatForm.requestSubmit();
  }
});

// ---------- 初始化 ----------
renderLedger();
