import { $, $$, formatDate, formatDateCN, formatMoney, formatWeight, formatPercent, getToday, vibrate, showToast } from './utils.js';
import { openDB, addTransaction, updateTransaction, deleteTransaction, getTransaction, getAllTransactions, getTransactionsByFilter, getCachedPrice, savePriceCache, getPricesOnDate } from './db.js';
import { calculatePnL } from './calculator.js';
import { renderCalendar, setCalendarClickHandler } from './calendar.js';
import { fileToBase64 } from './imageUtils.js';

let currentPage = 'home';
let currentFilter = 'all';
let editingId = null;
let tempPhotos = [];
let currentCalendarYear, currentCalendarMonth;
let goldPriceData = null;
let silverPriceData = null;

document.addEventListener('DOMContentLoaded', async () => {
  await openDB();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  const restored = await restoreFromLocalStorage();
  if (restored) {
    await backupToLocalStorage();
  }

  const hasVisited = localStorage.getItem('gold_saver_onboarded');
  if (!hasVisited) {
    showOnboarding();
  }

  setupNavigation();
  setupFab();
  setupForm();
  setupImageHandlers();
  setupCalendar();
  setupManualPrice();

  await loadManualPrices();
  await renderHome();
  await renderRecords();
  await renderCalendarView();
});

function showOnboarding() {
  const el = $('#onboarding');
  el.classList.remove('hidden');
  let slide = 0;
  const slides = $$('.onboarding-slide', el);
  const dots = $$('.dot', el);
  const nextBtn = $('#onboardingNext');
  const skipBtn = $('#onboardingSkip');

  function updateSlide() {
    slides.forEach((s, i) => s.classList.toggle('active', i === slide));
    dots.forEach((d, i) => d.classList.toggle('active', i === slide));
    nextBtn.textContent = slide === 2 ? '开始使用' : '下一步';
  }

  nextBtn.addEventListener('click', () => {
    if (slide < 2) {
      slide++;
      updateSlide();
    } else {
      localStorage.setItem('gold_saver_onboarded', '1');
      el.classList.add('hidden');
    }
  });

  skipBtn.addEventListener('click', () => {
    localStorage.setItem('gold_saver_onboarded', '1');
    el.classList.add('hidden');
  });

  updateSlide();
}

function setupNavigation() {
  $$('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const page = btn.dataset.page;
      navigateTo(page);
    });
  });
  $('#viewAllBtn').addEventListener('click', () => navigateTo('records'));
}

function navigateTo(page) {
  currentPage = page;
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  $$('.page').forEach(p => p.classList.toggle('active', p.id === `page-${page}`));
  if (page === 'home') renderHome();
  if (page === 'calendar') renderCalendarView();
  if (page === 'records') renderRecords();
}

function setupFab() {
  const fab = $('#fab');
  const menu = $('#fabMenu');
  const overlay = $('#fabOverlay');
  let menuOpen = false;

  fab.addEventListener('click', () => {
    menuOpen = !menuOpen;
    menu.classList.toggle('hidden', !menuOpen);
    overlay.classList.toggle('hidden', !menuOpen);
    vibrate();
  });

  overlay.addEventListener('click', closeFabMenu);

  $$('.fab-menu-item').forEach(item => {
    item.addEventListener('click', () => {
      const action = item.dataset.action;
      let type = 'buy', metal = 'gold';
      if (action === 'buy-gold') { type = 'buy'; metal = 'gold'; }
      if (action === 'buy-silver') { type = 'buy'; metal = 'silver'; }
      if (action === 'sell') { type = 'sell'; metal = 'gold'; }
      openForm({ type, metal });
      closeFabMenu();
    });
  });

  function closeFabMenu() {
    menuOpen = false;
    menu.classList.add('hidden');
    overlay.classList.add('hidden');
  }
}

function setupForm() {
  const form = $('#transactionForm');
  const modal = $('#formModal');
  const closeBtn = $('#formCloseBtn');
  const deleteBtn = $('#formDeleteBtn');

  closeBtn.addEventListener('click', closeForm);
  $('#formModal .modal-backdrop').addEventListener('click', closeForm);

  deleteBtn.addEventListener('click', async () => {
    if (!editingId) return;
    showConfirm(
      '确认删除',
      '确定要删除这条记录吗？此操作无法撤销。',
      async () => {
        await deleteTransaction(editingId);
        await backupToLocalStorage();
        showToast('已删除');
        closeForm();
        await renderHome();
        await renderRecords();
        await renderCalendarView();
      }
    );
  });

  const typeSegBtns = $$('#typeSegment .seg-btn');
  typeSegBtns.forEach(b => {
    b.addEventListener('click', () => {
      typeSegBtns.forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      updateTotal();
    });
  });

  const metalSegBtns = $$('#metalSegment .seg-btn');
  metalSegBtns.forEach(b => {
    b.addEventListener('click', () => {
      metalSegBtns.forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      updateTotal();
    });
  });

  $('#formWeight').addEventListener('input', updateTotal);
  $('#formPrice').addEventListener('input', updateTotal);
  $('#formTotal').addEventListener('input', updatePriceFromTotal);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveTransaction();
  });
}

function updateTotal() {
  const weight = parseFloat($('#formWeight').value) || 0;
  const price = parseFloat($('#formPrice').value) || 0;
  const total = weight * price;
  $('#formTotal').value = total > 0 ? total.toFixed(2) : '';
}

function updatePriceFromTotal() {
  const weight = parseFloat($('#formWeight').value) || 0;
  const total = parseFloat($('#formTotal').value) || 0;
  if (weight > 0 && total > 0) {
    $('#formPrice').value = (total / weight).toFixed(2);
  }
}

function setupImageHandlers() {
  const input = $('#photoInput');
  $('#addPhotoBtn').addEventListener('click', () => input.click());
  input.addEventListener('change', async (e) => {
    const files = [...e.target.files];
    const remaining = 3 - tempPhotos.length;
    const toProcess = files.slice(0, remaining);

    for (const file of toProcess) {
      try {
        const base64 = await fileToBase64(file);
        tempPhotos.push(base64);
      } catch (err) {
        showToast('图片处理失败');
      }
    }

    if (files.length > remaining) {
      showToast(`最多3张图片，已保留前${remaining}张`);
    }

    renderPhotoPreviews();
    input.value = '';
  });
}

function renderPhotoPreviews() {
  const container = $('#photoPreviews');
  const addBtn = $('#addPhotoBtn');

  container.innerHTML = tempPhotos.map((img, i) => `
    <div class="photo-preview-wrap">
      <img src="${img}" alt="凭证照片${i + 1}">
      <button type="button" class="photo-delete-btn" data-photo-index="${i}">✕</button>
    </div>
  `).join('');

  addBtn.style.display = tempPhotos.length >= 3 ? 'none' : '';

  $$('.photo-delete-btn', container).forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.photoIndex);
      tempPhotos.splice(idx, 1);
      renderPhotoPreviews();
    });
  });

  $$('img', container).forEach(img => {
    img.addEventListener('click', () => showImagePreview(img.src));
  });
}

function showImagePreview(src) {
  const modal = $('#imagePreviewModal');
  modal.classList.remove('hidden');
  $('#imagePreviewImg').src = src;

  const close = () => modal.classList.add('hidden');
  $('#imagePreviewClose').addEventListener('click', close, { once: true });
  modal.querySelector('.modal-backdrop').addEventListener('click', close, { once: true });
}

function openForm(initial = {}) {
  editingId = null;
  tempPhotos = [];
  $('#formId').value = '';
  $('#formTitle').textContent = '添加交易记录';
  $('#formDeleteBtn').classList.add('hidden');

  setSegValue('typeSegment', initial.type || 'buy');
  setSegValue('metalSegment', initial.metal || 'gold');
  $('#formWeight').value = '';
  $('#formPrice').value = '';
  $('#formTotal').value = '';
  $('#formDate').value = getToday();
  $('#formSource').value = '';
  $('#formNote').value = '';

  if (initial.metal === 'gold' && goldPriceData?.priceCNYPerGram) {
    $('#formPrice').value = goldPriceData.priceCNYPerGram;
  } else if (initial.metal === 'silver' && silverPriceData?.priceCNYPerGram) {
    $('#formPrice').value = silverPriceData.priceCNYPerGram;
  }

  renderPhotoPreviews();
  $('#addPhotoBtn').style.display = '';
  $('#formModal').classList.remove('hidden');
}

export async function editTransaction(id) {
  const record = await getTransaction(id);
  if (!record) return;

  editingId = id;
  tempPhotos = [...(record.images || [])];
  $('#formId').value = id;
  $('#formTitle').textContent = '编辑交易记录';
  $('#formDeleteBtn').classList.remove('hidden');

  setSegValue('typeSegment', record.type);
  setSegValue('metalSegment', record.metal);
  $('#formWeight').value = record.weight;
  $('#formPrice').value = record.pricePerGram;
  $('#formTotal').value = record.totalAmount;
  $('#formDate').value = record.date;
  $('#formSource').value = record.source || '';
  $('#formNote').value = record.note || '';

  renderPhotoPreviews();
  $('#addPhotoBtn').style.display = tempPhotos.length >= 3 ? 'none' : '';
  $('#formModal').classList.remove('hidden');
}

function closeForm() {
  $('#formModal').classList.add('hidden');
  editingId = null;
  tempPhotos = [];
}

function setSegValue(segmentId, value) {
  const btns = $$(`#${segmentId} .seg-btn`);
  btns.forEach(b => b.classList.toggle('active', b.dataset.value === value));
}

function getSegValue(segmentId) {
  const active = $(`#${segmentId} .seg-btn.active`);
  return active ? active.dataset.value : null;
}

function getFormData() {
  const weight = parseFloat($('#formWeight').value) || 0;
  const pricePerGram = parseFloat($('#formPrice').value) || 0;

  const dateStr = $('#formDate').value;

  return {
    type: getSegValue('typeSegment'),
    metal: getSegValue('metalSegment'),
    weight,
    pricePerGram,
    totalAmount: weight * pricePerGram,
    date: dateStr,
    source: $('#formSource').value || '其他',
    note: $('#formNote').value,
    images: [...tempPhotos]
  };
}

function validateForm(data) {
  if (!data.weight || data.weight <= 0) { showToast('请输入有效克重'); return false; }
  if (!data.pricePerGram || data.pricePerGram <= 0) { showToast('请输入有效单价'); return false; }
  if (!data.date) { showToast('请选择交易日期'); return false; }
  if (data.date > getToday()) { showToast('日期不能是未来日期'); return false; }
  return true;
}

async function validateSellLimit(data) {
  if (data.type !== 'sell') return true;
  const holdings = await calculatePnL(data.metal, 0);
  if (data.weight > holdings.totalWeight + 0.001) {
    const metalName = data.metal === 'gold' ? '黄金' : '白银';
    showToast(`卖出克重(${formatWeight(data.weight)}克)超过当前${metalName}持仓(${formatWeight(holdings.totalWeight)}克)`);
    return false;
  }
  return true;
}

async function saveTransaction() {
  const data = getFormData();
  if (!validateForm(data)) return;

  if (data.type === 'sell') {
    const ok = await validateSellLimit(data);
    if (!ok) return;
  }

  try {
    if (editingId) {
      await updateTransaction(editingId, data);
      showToast('记录已更新');
    } else {
      await addTransaction(data);
      showToast('记录已保存');
    }
    vibrate();
    closeForm();
    await backupToLocalStorage();
    await renderHome();
    await renderRecords();
    await renderCalendarView();
  } catch (e) {
    showToast('保存失败，请重试');
    console.error(e);
  }
}

async function backupToLocalStorage() {
  try {
    const all = await getAllTransactions();
    localStorage.setItem('gold_saver_backup', JSON.stringify(all));
    localStorage.setItem('gold_saver_backup_time', new Date().toISOString());
  } catch (e) {
    console.error('Backup failed:', e);
  }
}

async function restoreFromLocalStorage() {
  try {
    const backup = localStorage.getItem('gold_saver_backup');
    if (!backup) return;
    const data = JSON.parse(backup);
    if (!Array.isArray(data) || data.length === 0) return;
    const existing = await getAllTransactions();
    if (existing.length > 0) return;
    for (const record of data) {
      await addTransaction(record);
    }
    showToast(`已从本地备份恢复 ${data.length} 条记录`);
    return true;
  } catch (e) {
    console.error('Restore failed:', e);
    return false;
  }
}

async function loadManualPrices() {
  const gold = await getCachedPrice('gold');
  if (gold) {
    goldPriceData = gold;
    $('#manualGoldPrice').value = gold.priceCNYPerGram;
  }
  const silver = await getCachedPrice('silver');
  if (silver) {
    silverPriceData = silver;
    $('#manualSilverPrice').value = silver.priceCNYPerGram;
  }
  updatePriceStatus();
}

function setupManualPrice() {
  $('#manualPriceSave').addEventListener('click', async () => {
    const goldVal = parseFloat($('#manualGoldPrice').value);
    const silverVal = parseFloat($('#manualSilverPrice').value);
    if (!goldVal && !silverVal) { showToast('请至少输入一个价格'); return; }
    const now = new Date().toISOString();
    if (goldVal > 0) {
      goldPriceData = {
        metal: 'gold',
        priceCNYPerGram: goldVal,
        priceUSDPerOunce: Math.round(goldVal * 31.1035 / 7.25 * 100) / 100,
        updatedAt: now,
        source: 'manual'
      };
      await savePriceCache(goldPriceData);
    }
    if (silverVal > 0) {
      silverPriceData = {
        metal: 'silver',
        priceCNYPerGram: silverVal,
        priceUSDPerOunce: Math.round(silverVal * 31.1035 / 7.25 * 100) / 100,
        updatedAt: now,
        source: 'manual'
      };
      await savePriceCache(silverPriceData);
    }
    updatePriceStatus();
    showToast('价格已更新');
    await renderHome();
  });
}

function updatePriceStatus() {
  const saved = $('#manualPriceSaved');
  const ts = $('#priceTimestamp');
  if (goldPriceData?.updatedAt) {
    const d = new Date(goldPriceData.updatedAt);
    const time = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    saved.textContent = `✅ 上次设定：${d.getMonth() + 1}/${d.getDate()} ${time}`;
    saved.style.color = '';
    ts.textContent = '';
  } else {
    saved.textContent = '⚠️ 尚未设定价格，请输入后点击更新';
    saved.style.color = '#C4544A';
    ts.textContent = '';
  }
}

async function renderHome() {
  if (currentPage !== 'home') return;

  const goldPnL = await calculatePnL('gold', goldPriceData?.priceCNYPerGram || 0);
  const silverPnL = await calculatePnL('silver', silverPriceData?.priceCNYPerGram || 0);

  $('#goldWeight').textContent = formatWeight(goldPnL.totalWeight) + ' 克';
  $('#goldCost').textContent = formatMoney(goldPnL.totalCost);
  $('#goldAvgPrice').textContent = goldPnL.avgCost > 0 ? formatMoney(goldPnL.avgCost) + '/克' : '--';
  $('#goldValue').textContent = goldPriceData ? formatMoney(goldPnL.currentValue) : '需设定金价';

  const goldPnlEl = $('#goldPnL');
  if (goldPriceData) {
    goldPnlEl.textContent = `${goldPnL.unrealizedPnL >= 0 ? '+' : ''}${formatMoney(goldPnL.unrealizedPnL)} (${formatPercent(goldPnL.unrealizedPnLPercent)})`;
    goldPnlEl.className = 'asset-pnl ' + (goldPnL.unrealizedPnL >= 0 ? 'positive' : 'negative');
  } else {
    goldPnlEl.textContent = '请先设定金价';
    goldPnlEl.className = 'asset-pnl';
  }

  $('#silverWeight').textContent = formatWeight(silverPnL.totalWeight) + ' 克';
  $('#silverCost').textContent = formatMoney(silverPnL.totalCost);
  $('#silverAvgPrice').textContent = silverPnL.avgCost > 0 ? formatMoney(silverPnL.avgCost) + '/克' : '--';
  $('#silverValue').textContent = silverPriceData ? formatMoney(silverPnL.currentValue) : '需设定银价';

  const silverPnlEl = $('#silverPnL');
  if (silverPriceData) {
    silverPnlEl.textContent = `${silverPnL.unrealizedPnL >= 0 ? '+' : ''}${formatMoney(silverPnL.unrealizedPnL)} (${formatPercent(silverPnL.unrealizedPnLPercent)})`;
    silverPnlEl.className = 'asset-pnl ' + (silverPnL.unrealizedPnL >= 0 ? 'positive' : 'negative');
  } else {
    silverPnlEl.textContent = '请先设定银价';
    silverPnlEl.className = 'asset-pnl';
  }

  const allTx = await getAllTransactions();
  const recent = allTx.slice(0, 5);
  const recentContainer = $('#recentTransactions');

  if (recent.length === 0) {
    recentContainer.innerHTML = '<div class="empty-hint">还没有交易记录</div>';
  } else {
    recentContainer.innerHTML = recent.map(tx => renderRecentItem(tx)).join('');
    $$('.recent-item', recentContainer).forEach(item => {
      item.addEventListener('click', () => {
        const id = item.dataset.id;
        editTransaction(id);
      });
    });
  }

  const backupTime = localStorage.getItem('gold_saver_backup_time');
  if (backupTime) {
    const d = new Date(backupTime);
    $('#backupInfo').textContent = `最近备份：${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }

  const now = new Date();
  $('#headerDate').textContent = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${['日','一','二','三','四','五','六'][now.getDay()]}`;
}

function renderRecentItem(tx) {
  const iconMap = {
    'buy-gold': '🟡',
    'buy-silver': '⚪',
    'sell-gold': '📤',
    'sell-silver': '📤'
  };
  const iconKey = `${tx.type}-${tx.metal}`;
  const icon = iconMap[iconKey] || '💰';

  const thumbHtml = tx.images && tx.images.length > 0
    ? `<img class="recent-item-thumb" src="${tx.images[0]}" alt="">`
    : '';

  return `
    <div class="recent-item" data-id="${tx.id}">
      <div class="recent-item-icon ${tx.type}-${tx.metal}">${icon}</div>
      <div class="recent-item-info">
        <div class="recent-item-title">${tx.type === 'buy' ? '买入' : '卖出'}${tx.metal === 'gold' ? '黄金' : '白银'}</div>
        <div class="recent-item-meta">${tx.date} · ${tx.source}</div>
      </div>
      ${thumbHtml}
      <div class="recent-item-right">
        <div class="recent-item-amount">${formatMoney(tx.totalAmount)}</div>
        <div class="recent-item-weight">${formatWeight(tx.weight)}克</div>
      </div>
    </div>
  `;
}

async function renderRecords() {
  if (currentPage !== 'records') return;

  const container = $('#recordsList');
  let records;
  if (currentFilter === 'all') {
    records = await getAllTransactions();
  } else if (currentFilter === 'gold' || currentFilter === 'silver') {
    records = await getTransactionsByFilter({ metal: currentFilter });
  } else {
    records = await getTransactionsByFilter({ type: currentFilter });
  }

  if (records.length === 0) {
    container.innerHTML = `
      <div class="records-empty">
        <div class="records-empty-icon">📋</div>
        <p>还没有任何记录</p>
        <button id="startRecordBtn" class="btn btn-primary">开始记录</button>
      </div>
    `;
    const btn = $('#startRecordBtn');
    if (btn) btn.addEventListener('click', () => openForm());
    return;
  }

  const grouped = {};
  for (const r of records) {
    if (!grouped[r.date]) grouped[r.date] = [];
    grouped[r.date].push(r);
  }

  container.innerHTML = Object.entries(grouped).map(([date, items]) => `
    <div class="record-group">
      <div class="record-group-date">${formatDateCN(date)}</div>
      ${items.map(r => renderRecordCard(r)).join('')}
    </div>
  `).join('');

  setupRecordCardListeners();
}

function renderRecordCard(r) {
  const metalIcon = r.metal === 'gold' ? '🟡' : '⚪';
  const typeTag = r.type === 'buy' ? '买入' : '卖出';
  const typeCls = r.type;

  const imagesHtml = r.images && r.images.length > 0
    ? `<div class="record-images">${r.images.map((img, i) => `<img class="record-image-thumb" src="${img}" alt="凭证${i+1}" data-src="${img}">`).join('')}</div>`
    : '';

  return `
    <div class="record-card" data-id="${r.id}">
      <div class="record-card-top">
        <span class="record-metal-icon">${metalIcon}</span>
        <div class="record-info">
          <div class="record-info-top">
            <span class="record-type-tag ${typeCls}">${typeTag}</span>
            <span class="record-source">${r.source}</span>
          </div>
          <div class="record-meta">${formatWeight(r.weight)}克 · 单价${formatMoney(r.pricePerGram)}</div>
        </div>
        <div class="record-amount">
          <span class="amount-main">${formatMoney(r.totalAmount)}</span>
          <span class="amount-unit">${formatWeight(r.weight)}克</span>
        </div>
      </div>
      ${imagesHtml}
    </div>
  `;
}

function setupRecordCardListeners() {
  $$('.record-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.record-image-thumb')) return;
      const id = card.dataset.id;
      editTransaction(id);
    });
  });

  $$('.record-image-thumb').forEach(img => {
    img.addEventListener('click', (e) => {
      e.stopPropagation();
      showImagePreview(img.dataset.src);
    });
  });
}

$('#filterBar').addEventListener('click', (e) => {
  const btn = e.target.closest('.filter-btn');
  if (!btn) return;
  $$('#filterBar .filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentFilter = btn.dataset.filter;
  renderRecords();
});

function setupCalendar() {
  setCalendarClickHandler((dateStr, data) => {
    showDaySheet(dateStr, data);
  });

  const now = new Date();
  currentCalendarYear = now.getFullYear();
  currentCalendarMonth = now.getMonth();

  $('#calPrevMonth').addEventListener('click', () => {
    if (currentCalendarMonth === 0) {
      currentCalendarYear--;
      currentCalendarMonth = 11;
    } else {
      currentCalendarMonth--;
    }
    renderCalendarView();
  });

  $('#calNextMonth').addEventListener('click', () => {
    if (currentCalendarMonth === 11) {
      currentCalendarYear++;
      currentCalendarMonth = 0;
    } else {
      currentCalendarMonth++;
    }
    renderCalendarView();
  });

  $('#sheetCloseBtn').addEventListener('click', closeDaySheet);
  $('#daySheet .sheet-backdrop').addEventListener('click', closeDaySheet);
}

async function renderCalendarView() {
  if (currentPage !== 'calendar') return;

  const grid = $('#calendarGrid');
  const stats = $('#calendarStats');
  const emptyEl = $('#calendarEmpty');

  $('#calMonthTitle').textContent = `${currentCalendarYear}年${currentCalendarMonth + 1}月`;

  const result = await renderCalendar(grid, stats, currentCalendarYear, currentCalendarMonth);

  const allTx = await getAllTransactions();
  if (allTx.length === 0) {
    emptyEl.classList.remove('hidden');
  } else {
    emptyEl.classList.add('hidden');
  }
}

async function showDaySheet(dateStr, data) {
  $('#sheetDate').textContent = formatDateCN(dateStr);
  const body = $('#sheetBody');
  const summary = $('#sheetSummary');

  const allItems = [...data.gold, ...data.silver];
  body.innerHTML = allItems.map(tx => {
    const icon = tx.metal === 'gold' ? '🟡' : '⚪';
    const typeTag = tx.type === 'buy' ? '买入' : '卖出';
    const imagesHtml = tx.images && tx.images.length > 0
      ? `<div class="sheet-item-images">${tx.images.map(img => `<img src="${img}" alt="" data-src="${img}">`).join('')}</div>`
      : '';
    return `
      <div class="sheet-item">
        <span class="sheet-item-icon">${icon}</span>
        <div class="sheet-item-info">
          <div class="sheet-item-title">${typeTag} · ${tx.source}</div>
          <div class="sheet-item-meta">${formatWeight(tx.weight)}克 × ${formatMoney(tx.pricePerGram)}</div>
          ${imagesHtml}
        </div>
        <span class="sheet-item-amount">${formatMoney(tx.totalAmount)}</span>
      </div>
    `;
  }).join('');

  const totalDayWeight = data.totalWeight;
  const totalDayAmount = data.totalAmount;
  let priceInfo = '';

  const dayPrices = await getPricesOnDate(dateStr);
  if (dayPrices.gold || dayPrices.silver) {
    const parts = [];
    if (dayPrices.gold) parts.push(`🟡 黄金 ${formatMoney(dayPrices.gold.priceCNYPerGram)}/克`);
    if (dayPrices.silver) parts.push(`⚪ 白银 ${formatMoney(dayPrices.silver.priceCNYPerGram)}/克`);
    priceInfo = `<div class="sheet-price-info">📊 当日金价：${parts.join(' · ')}</div>`;
  }

  summary.innerHTML = `当日合计：⚖️ ${formatWeight(totalDayWeight)}克 | 💰 ${formatMoney(totalDayAmount)}${priceInfo}`;

  $('#daySheet').classList.remove('hidden');

  $$('.sheet-item-images img', body).forEach(img => {
    img.addEventListener('click', (e) => {
      e.stopPropagation();
      showImagePreview(img.dataset.src);
    });
  });
}

function closeDaySheet() {
  $('#daySheet').classList.add('hidden');
}

function showConfirm(title, msg, onOk) {
  const dialog = $('#confirmDialog');
  $('#confirmTitle').textContent = title;
  $('#confirmMsg').textContent = msg;
  dialog.classList.remove('hidden');

  const close = () => dialog.classList.add('hidden');

  const cancelBtn = $('#confirmCancelBtn');
  const okBtn = $('#confirmOkBtn');

  const cancelHandler = () => { close(); };
  const okHandler = () => { close(); onOk(); };

  cancelBtn.replaceWith(cancelBtn.cloneNode(true));
  okBtn.replaceWith(okBtn.cloneNode(true));

  $('#confirmCancelBtn').addEventListener('click', cancelHandler);
  $('#confirmOkBtn').addEventListener('click', okHandler);
  dialog.querySelector('.modal-backdrop').addEventListener('click', cancelHandler);
}

$('#startRecordBtn')?.addEventListener('click', () => openForm());

// Export / Import
$('#exportDataBtn').addEventListener('click', async () => {
  try {
    const transactions = await getAllTransactions();
    const { getCachedPrice } = await import('./db.js');
    const goldPrice = await getCachedPrice('gold');
    const silverPrice = await getCachedPrice('silver');

    const backup = {
      version: 1,
      exportedAt: new Date().toISOString(),
      transactions,
      priceCache: { gold: goldPrice, silver: silverPrice }
    };

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const d = new Date();
    a.download = `金灿灿_备份_${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`已导出 ${transactions.length} 条记录`);
    vibrate();
  } catch (e) {
    showToast('导出失败');
    console.error(e);
  }
});

$('#importDataBtn').addEventListener('click', () => {
  $('#importFileInput').click();
});

$('#importFileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  showConfirm(
    '确认导入',
    '导入将覆盖当前所有数据（含照片），建议先导出现有数据备份。确定要导入吗？',
    async () => {
      try {
        const text = await file.text();
        const data = JSON.parse(text);

        if (!data.transactions || !Array.isArray(data.transactions)) {
          showToast('备份文件格式无效');
          return;
        }

        const { addTransaction, savePriceCache } = await import('./db.js');

        const existing = await getAllTransactions();
        for (const r of existing) {
          await deleteTransaction(r.id);
        }

        for (const r of data.transactions) {
          await addTransaction(r);
        }

        if (data.priceCache?.gold) {
          await savePriceCache({ ...data.priceCache.gold, updatedAt: new Date().toISOString() });
          goldPriceData = data.priceCache.gold;
          $('#manualGoldPrice').value = data.priceCache.gold.priceCNYPerGram || '';
        }
        if (data.priceCache?.silver) {
          await savePriceCache({ ...data.priceCache.silver, updatedAt: new Date().toISOString() });
          silverPriceData = data.priceCache.silver;
          $('#manualSilverPrice').value = data.priceCache.silver.priceCNYPerGram || '';
        }

        await backupToLocalStorage();
        updatePriceStatus();
        await renderHome();
        await renderRecords();
        await renderCalendarView();

        showToast(`已导入 ${data.transactions.length} 条记录`);
        vibrate();
      } catch (err) {
        showToast('导入失败，请检查文件格式');
        console.error(err);
      }
    }
  );

  e.target.value = '';
});

console.log('🔒 金灿灿 — 所有数据（含照片）仅存储在您设备的浏览器本地，不会上传到任何服务器。');
