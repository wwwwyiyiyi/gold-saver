import { getAllTransactions } from './db.js';
import { formatDate, formatMoney, formatWeight } from './utils.js';

let currentYear, currentMonth;
let onDateClick = null;

export function setCalendarClickHandler(handler) {
  onDateClick = handler;
}

export async function renderCalendar(container, statsContainer, year, month) {
  currentYear = year;
  currentMonth = month;

  const transactions = await getAllTransactions();
  const dateMap = {};
  for (const tx of transactions) {
    if (!dateMap[tx.date]) {
      dateMap[tx.date] = { gold: [], silver: [], totalWeight: 0, totalAmount: 0 };
    }
    dateMap[tx.date][tx.metal].push(tx);
    dateMap[tx.date].totalWeight += tx.type === 'buy' ? tx.weight : -tx.weight;
    dateMap[tx.date].totalAmount += tx.type === 'buy' ? tx.totalAmount : -tx.totalAmount;
  }

  const daysWithRecords = Object.keys(dateMap).length;
  let totalWeight = 0;
  let totalAmount = 0;
  for (const tx of transactions) {
    if (tx.type === 'buy') {
      totalWeight += tx.weight;
      totalAmount += tx.totalAmount;
    } else {
      totalWeight -= tx.weight;
      totalAmount -= tx.totalAmount;
    }
  }

  if (statsContainer) {
    statsContainer.innerHTML = `
      <span>📅 攒金 <strong>${daysWithRecords}</strong> 天</span>
      <span>⚖️ 累计 <strong>${formatWeight(Math.max(0, totalWeight))}</strong> 克</span>
      <span>💰 总投入 <strong>${formatMoney(Math.max(0, totalAmount))}</strong></span>
    `;
  }

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  const today = formatDate(new Date());

  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  let html = weekdays.map(w => `<div class="calendar-weekday">${w}</div>`).join('');

  let cellCount = 0;

  for (let i = firstDay - 1; i >= 0; i--) {
    const day = daysInPrevMonth - i;
    html += `<div class="calendar-cell other-month">${day}</div>`;
    cellCount++;
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const data = dateMap[dateStr];
    let cls = 'calendar-cell';
    let inner = '';

    if (data) {
      cls += ' has-record';
      let dotClass = '';
      if (data.gold.length > 0 && data.silver.length > 0) {
        dotClass = 'both';
      } else if (data.gold.length > 0) {
        dotClass = 'gold';
      } else {
        dotClass = 'silver';
      }
      const dayWeight = data.gold.reduce((s, t) => s + t.weight, 0) + data.silver.reduce((s, t) => s + t.weight, 0);
      inner = `<span class="cal-dot ${dotClass}"></span>`;
      if (dayWeight >= 1) {
        inner += `<span class="cal-weight">${Math.round(dayWeight)}g</span>`;
      }
    }

    if (dateStr === today) {
      cls += ' today';
    }

    html += `<div class="${cls}" data-date="${dateStr}">${day}${inner}</div>`;
    cellCount++;
  }

  while (cellCount % 7 !== 0) {
    const day = cellCount - (daysInMonth + firstDay) + 1;
    html += `<div class="calendar-cell other-month">${day}</div>`;
    cellCount++;
  }

  container.innerHTML = html;

  container.querySelectorAll('.has-record').forEach(cell => {
    cell.addEventListener('click', () => {
      const dateStr = cell.dataset.date;
      if (onDateClick && dateStr && dateMap[dateStr]) {
        onDateClick(dateStr, dateMap[dateStr]);
      }
    });
  });

  return { dateMap, totalWeight: Math.max(0, totalWeight), totalAmount: Math.max(0, totalAmount) };
}
