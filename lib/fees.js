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

// There is no external payment processor anymore — every crypto payment
// goes directly to the operator's own wallet, so there is no gateway fee
// to pass on to the buyer.
function gatewayFeePercent() {
  return 0;
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
  const provider = (process.env.PAYMENT_PROVIDER || '').toLowerCase();
  return {
    platformFeePercent: platformFeePercent(),
    gatewayFeePercent: gatewayFeePercent(),
    provider,
    platformFeeChargedTo: 'seller',
    platformFeeChargedWhen: 'on_payout',
    gatewayFeePaidBy: null,
    buyerPaysGatewayFee: false,
  };
}

module.exports = {
  platformFeePercent,
  gatewayFeePercent,
  calcDealFees,
  feeConfig,
};
