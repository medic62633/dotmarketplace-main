/* Shared input validation for id fields that end up inside Mongo queries.
 * A JSON body can carry objects ({"$ne": null}) as easily as strings — without
 * a typeof check those operator objects reach findOne/insertOne on money paths
 * and corrupt or leak records. Ids in this system are short strings. */
function isId(v) {
  return typeof v === 'string' && v.length >= 4 && v.length <= 80;
}

module.exports = { isId };
