// Lesson 0005 lab helpers: journal and checkpoint stats, write latency with and without j:true.
//
// Usage (after seeding store.reviews with seed-reviews.js):
//   docker cp lessons/code/0005-durability-lab.js mongo-lab5:/lab5.js
//   docker exec -it mongo-lab5 mongosh store
//   > load("/lab5.js")
//
// All functions write to store.reviews only. New reviews get a fresh ObjectId (today's time),
// so they sort after the seeded ones.

const WT = () => db.serverStatus().wiredTiger;

// The journal and checkpoint numbers this lesson talks about, in one object.
function durability() {
  const s = WT(), l = s.log, c = s.checkpoint, cache = s.cache;
  return {
    logSyncs: l["log sync operations"],
    logSyncMs: Math.round(l["log sync time duration (usecs)"] / 1000),
    logMB: +(l["log bytes written"] / 2 ** 20).toFixed(1),
    checkpoints: c["total succeed number of checkpoints"],
    lastCheckpointMs: c["most recent time (msecs)"],
    maxCheckpointMs: c["max time (msecs)"],
    dirtyPct: +(100 * cache["tracked dirty bytes in the cache"] / cache["maximum bytes configured"]).toFixed(1)
  };
}

// A deterministic new review (same shape as the seed data).
let labSeq = 0;
function newReview() {
  labSeq++;
  return {
    review: `Lab review ${labSeq}: battery lasts for days.`,
    rating: 1 + (labSeq % 5),
    tags: labSeq % 2 ? ["battery"] : ["battery", "quality"],
    verified: labSeq % 10 < 7
  };
}

// Insert n reviews one at a time with the given write concern.
// Returns latency percentiles (ms) and how many journal syncs happened meanwhile.
function timeInserts(n, wc) {
  const before = WT().log;
  const ms = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    db.reviews.insertOne(newReview(), { writeConcern: wc });
    ms.push(performance.now() - t0);
  }
  const after = WT().log;
  ms.sort((a, b) => a - b);
  const pct = p => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))];
  return {
    wc: JSON.stringify(wc),
    n,
    avgMs: +(ms.reduce((a, b) => a + b, 0) / n).toFixed(2),
    p50: +pct(0.5).toFixed(2), p99: +pct(0.99).toFixed(2), max: +ms[ms.length - 1].toFixed(1),
    logSyncs: after["log sync operations"] - before["log sync operations"]
  };
}

// Same n reviews, but in one insertMany with j:true: one journal sync for the whole batch.
function timeBatch(n) {
  const docs = Array.from({ length: n }, newReview);
  const before = WT().log, t0 = performance.now();
  db.reviews.insertMany(docs, { writeConcern: { w: 1, j: true } });
  const after = WT().log;
  return { n, totalMs: Math.round(performance.now() - t0),
           logSyncs: after["log sync operations"] - before["log sync operations"] };
}

print("loaded: durability(), timeInserts(n, wc), timeBatch(n)");
