// Lesson 0004 lab helpers: write conflicts and pinned history on store.reviews.
// Needs a replica set (transactions do), seeded with seed-reviews.js (default 100,000 reviews).
//
// Adds one field to the course schema: `helpful` (a "was this review helpful?" vote counter).
// The race needs a number that many clients bump at once; the five standard fields stay as they are.
//
// Usage (from the host, in the topic folder):
//   docker cp lessons/code/0004-concurrency-lab.js mongo-lab4:/lab.js
//   # one racer (run two of these at the same time to race):
//   docker exec mongo-lab4 mongosh store --quiet --eval 'const RACE = 5000' --file /lab.js
//   # race two *different* reviews instead (the control run):
//   docker exec mongo-lab4 mongosh store --quiet --eval 'const RACE = 5000, WHICH = 1' --file /lab.js
//   # interactive: open a shell, then load the helpers (REVIEW, OTHER, wc, pinStats, churn)
//   docker exec -it mongo-lab4 mongosh store
//   > load('/lab.js')

// The first review in the seed data (2026-01-01T00:00:00Z) and the one written a second later.
const REVIEW = ObjectId('6955b9000000000000000000');
const OTHER = ObjectId('6955b9010000000000000001');

// MongoDB's write-conflict counter: every retry after a WriteConflictException adds one.
const wc = () => db.serverStatus().metrics.operation.writeConflicts;

// WiredTiger stats that show history being kept for old snapshots.
function pinStats() {
  const s = db.serverStatus().wiredTiger;
  return {
    pinnedIds: s.transaction['transaction range of IDs currently pinned'],
    hsInserts: s.cache['history store table insert calls'],
    hsCacheMB: +(s.cache['bytes belonging to the history store table in the cache'] / 2 ** 20).toFixed(1),
    dirtyPct: +(100 * s.cache['tracked dirty bytes in the cache'] / s.cache['maximum bytes configured']).toFixed(1)
  };
}

// Three passes of "+1 helpful vote" over every review: 3 x 100,000 small updates.
function churn() {
  const a = pinStats(), t0 = Date.now();
  for (let k = 0; k < 3; k++) db.reviews.updateMany({}, { $inc: { helpful: 1 } });
  const b = pinStats();
  return { ms: Date.now() - t0, pinnedIds: b.pinnedIds, hsInserts: b.hsInserts - a.hsInserts,
           hsCacheMB: b.hsCacheMB, dirtyPct: b.dirtyPct };
}

if (typeof RACE === 'number') {
  const id = (typeof WHICH === 'number' && WHICH === 1) ? OTHER : REVIEW;
  const before = wc(), t0 = Date.now();
  for (let i = 0; i < RACE; i++) db.reviews.updateOne({ _id: id }, { $inc: { helpful: 1 } });
  print(`${RACE} updates on ${id} in ${Date.now() - t0} ms; writeConflicts (whole server) +${wc() - before}`);
}
