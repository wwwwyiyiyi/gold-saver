import { getAllTransactions } from './db.js';

export async function calculateHoldings(metal) {
  const all = await getAllTransactions();
  const metalTxs = all.filter(t => t.metal === metal);
  const sorted = [...metalTxs].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));

  let totalWeight = 0;
  let totalCost = 0;
  let avgCost = 0;
  const history = [];

  for (const tx of sorted) {
    if (tx.type === 'buy') {
      const newWeight = totalWeight + tx.weight;
      avgCost = newWeight > 0
        ? (totalWeight * avgCost + tx.weight * tx.pricePerGram) / newWeight
        : tx.pricePerGram;
      totalWeight = newWeight;
      totalCost += tx.totalAmount;
    } else {
      totalWeight -= tx.weight;
      totalCost = totalWeight * avgCost;
    }
    history.push({ date: tx.date, weight: totalWeight, avgCost, totalCost });
  }

  return {
    totalWeight: Math.max(0, round(totalWeight)),
    totalCost: round(Math.max(0, totalCost)),
    avgCost: round(avgCost),
    history
  };
}

export async function calculatePnL(metal, currentPricePerGram) {
  const { totalWeight, totalCost, avgCost } = await calculateHoldings(metal);
  if (totalWeight <= 0 || avgCost <= 0) {
    return {
      totalWeight: 0,
      totalCost: 0,
      avgCost: 0,
      currentValue: 0,
      unrealizedPnL: 0,
      unrealizedPnLPercent: 0
    };
  }

  const currentValue = round(totalWeight * currentPricePerGram);
  const costBasis = round(totalWeight * avgCost);
  const unrealizedPnL = round(currentValue - costBasis);
  const unrealizedPnLPercent = costBasis > 0 ? round((unrealizedPnL / costBasis) * 100) : 0;

  return {
    totalWeight,
    totalCost,
    avgCost,
    currentValue,
    unrealizedPnL,
    unrealizedPnLPercent
  };
}

export function calculateRealizedPnL(sellWeight, sellPricePerGram, avgCost) {
  return round(sellWeight * (sellPricePerGram - avgCost));
}

export function checkSellAllowed(metal, currentHoldingWeight, sellWeight) {
  return sellWeight <= currentHoldingWeight;
}

function round(n) {
  return Math.round(n * 100) / 100;
}
