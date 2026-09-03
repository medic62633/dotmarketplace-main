function round2(n) {
  return Math.round(n * 100) / 100;
}

function parsePercent(envVal, fallback) {
  const n = parseFloat(envVal);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function platformFeePercent() {
  return parsePercent(process.env.PLATFORM_FEE_PERCENT, 2.5);
}

function gatewayFeePercent(provider) {
  const p = (provider || process.env.PAYMENT_PROVIDER || 'oxapay').toLowerCase();
  if (p === 'cryptomus') {
    return parsePercent(process.env.CRYPTOMUS_FEE_PERCENT, 2);
  }
  return parsePercent(process.env.OXAPAY_FEE_PERCENT, 0.5);
}

function calcDealFees(listingAmount, { provider, method } = {}) {
  const listing = parseFloat(listingAmount);
  if (!Number.isFinite(listing) || listing <= 0) {
    return emptyFees();
  }

  const platformRate = platformFeePercent() / 100;
  const isWallet = method === 'wallet';
  const platformFee = round2(listing * platformRate);
  const sellerNet = round2(listing - platformFee);

  if (isWallet) {
    return {
      listingAmount: listing,
      amount: listing,
      buyerTotal: listing,
      platformFee,
      platformFeePercent: platformFeePercent(),
      gatewayFee: 0,
      gatewayFeePercent: 0,
      gatewayFeePaidBy: null,
      sellerNet,
      merchantNet: listing,
    };
  }

  const gwPct = gatewayFeePercent(provider);
  const gwRate = gwPct / 100;
  const gatewayFee = round2(listing * gwRate);
  const buyerTotal = round2(listing + gatewayFee);

  return {
    listingAmount: listing,
    amount: listing,
    buyerTotal,
    platformFee,
    platformFeePercent: platformFeePercent(),
    gatewayFee,
    gatewayFeePercent: gwPct,
    gatewayFeePaidBy: 'buyer',
    sellerNet,
    merchantNet: listing,
  };
}

function emptyFees() {
  return {
    listingAmount: 0,
    amount: 0,
    buyerTotal: 0,
    platformFee: 0,
    platformFeePercent: platformFeePercent(),
    gatewayFee: 0,
    gatewayFeePercent: 0,
    gatewayFeePaidBy: null,
    sellerNet: 0,
    merchantNet: 0,
  };
}

function feeConfig() {
  const provider = (process.env.PAYMENT_PROVIDER || 'oxapay').toLowerCase();
  return {
    platformFeePercent: platformFeePercent(),
    gatewayFeePercent: gatewayFeePercent(provider),
    provider,
    platformFeeChargedTo: 'seller',
    platformFeeChargedWhen: 'on_payout',
    gatewayFeePaidBy: 'buyer',
    buyerPaysGatewayFee: true,
  };
}

module.exports = {
  platformFeePercent,
  gatewayFeePercent,
  calcDealFees,
  feeConfig,
};
