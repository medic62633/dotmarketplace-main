/** Listing categories — must stay in sync with the marketplace UI. */
const LISTING_CATEGORIES = [
  'accounts',
  'subscriptions',
  'software',
  'services',
  'digital',
  'gaming',
];

function isValidCategory(cat) {
  return LISTING_CATEGORIES.includes(String(cat || '').trim());
}

module.exports = { LISTING_CATEGORIES, isValidCategory };
