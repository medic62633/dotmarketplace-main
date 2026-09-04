/* Buyer's saved/favorited listings. One doc per user, keyed by email, with a
 * capped array of listing ids — mirrors the shape of the `states` collection
 * rather than a doc-per-favorite, since a buyer's saved list is always read
 * and written as a whole.
 */

const MAX_FAVORITES = 300;

function createFavoriteStore({ memory, favoritesCol }) {
  async function getIds(email) {
    const doc = memory ? memory.favorites.get(email) : await favoritesCol.findOne({ _id: email });
    return doc?.ids || [];
  }

  async function addFavorite(email, listingId) {
    if (memory) {
      const doc = memory.favorites.get(email) || { _id: email, ids: [], createdAt: new Date() };
      if (!doc.ids.includes(listingId)) {
        doc.ids.unshift(listingId);
        doc.ids = doc.ids.slice(0, MAX_FAVORITES);
      }
      doc.updatedAt = new Date();
      memory.favorites.set(email, doc);
      return doc.ids;
    }
    await favoritesCol.updateOne(
      { _id: email },
      {
        $addToSet: { ids: listingId },
        $set: { updatedAt: new Date() },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true }
    );
    const doc = await favoritesCol.findOne({ _id: email });
    let ids = doc?.ids || [];
    if (ids.length > MAX_FAVORITES) {
      ids = ids.slice(0, MAX_FAVORITES);
      await favoritesCol.updateOne({ _id: email }, { $set: { ids } });
    }
    return ids;
  }

  async function removeFavorite(email, listingId) {
    if (memory) {
      const doc = memory.favorites.get(email);
      if (doc) {
        doc.ids = (doc.ids || []).filter(id => id !== listingId);
        doc.updatedAt = new Date();
      }
      return doc?.ids || [];
    }
    const res = await favoritesCol.findOneAndUpdate(
      { _id: email },
      { $pull: { ids: listingId }, $set: { updatedAt: new Date() } },
      { returnDocument: 'after' }
    );
    const doc = res && (res.value !== undefined ? res.value : res);
    return doc?.ids || [];
  }

  return { getIds, addFavorite, removeFavorite };
}

module.exports = { createFavoriteStore };
