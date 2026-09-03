function formatNetworkLabel(network, currency) {
  const n = String(network || '').toLowerCase();
  const cur = String(currency || 'USDT').toUpperCase();
  if (!n) return null;
  if (n.includes('bsc') || n.includes('bep') || n.includes('binance')) return 'USDT (BEP-20)';
  if (n.includes('tron') || n.includes('trc')) return 'USDT (TRC-20)';
  if (n.includes('eth') || n.includes('erc') || n.includes('ethereum')) return 'USDT (ERC-20)';
  if (n.includes('polygon') || n.includes('matic')) return 'USDT (Polygon)';
  if (n.includes('ton')) return 'TON';
  if (n.includes('sol') || n.includes('solana')) return 'USDT (Solana)';
  if (cur === 'TON') return 'TON';
  return `${cur} (${network})`;
}

function formatPayMethod(record) {
  if (!record) return '—';
  if (record.payNetwork) return record.payNetwork;
  if (record.method === 'wallet') return 'Dot Wallet';
  if (record.method === 'ton') return 'TON';
  if (record.method === 'card') return 'Card';
  if (record.method === 'bep20') return 'USDT (BEP-20)';
  if (record.method === 'trc20') return 'USDT (TRC-20)';
  if (record.method === 'crypto') return 'USDT (Crypto)';
  return record.method || '—';
}

module.exports = { formatNetworkLabel, formatPayMethod };
