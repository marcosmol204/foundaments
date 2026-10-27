// Seed the course's standard example collection: store.reviews
// Schema: { _id: ObjectId, review: string, rating: number, tags: [string], verified: boolean }
//
// Usage (from the host):
//   docker cp lessons/code/seed-reviews.js mongo-lab:/seed-reviews.js
//   docker exec -it mongo-lab mongosh store --eval 'const N = 200000' --file /seed-reviews.js
// N defaults to 100000. Data is deterministic (seeded PRNG + computed _ids), so every run gives the same documents.

const COUNT = typeof N === "number" ? N : 100000;
const BATCH = 5000;
const BASE_TS = 1767225600; // 2026-01-01T00:00:00Z

// Small deterministic PRNG (mulberry32) so lab numbers are reproducible.
let seed = 42;
function rand() {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = arr => arr[Math.floor(rand() * arr.length)];

const TAGS = ["battery", "price", "quality", "shipping", "packaging", "size", "design", "support", "durability", "sound"];
const OPENERS = ["Honestly", "After two weeks", "Bought this as a gift and", "Second time ordering,", "Not sure yet, but", "Overall"];
const BODIES = {
  1: ["it broke on day one", "nothing like the photos", "support never answered", "returned it immediately"],
  2: ["the battery dies fast", "it feels cheap", "shipping took a month", "the size runs small"],
  3: ["it does the job", "fine for the price", "packaging was damaged but it works", "average quality"],
  4: ["really solid build", "good value for money", "sound is better than expected", "fast shipping, nice design"],
  5: ["best purchase this year", "excellent quality, would buy again", "battery lasts for days", "perfect, exactly as described"]
};
// Ratings skew positive, as on most real review sites.
const RATING_WEIGHTS = [[5, 0.45], [4, 0.25], [3, 0.12], [2, 0.08], [1, 0.10]];
function rating() {
  let r = rand();
  for (const [v, w] of RATING_WEIGHTS) { if ((r -= w) < 0) return v; }
  return 5;
}

db.reviews.drop();
for (let i = 0; i < COUNT; i += BATCH) {
  const docs = [];
  for (let j = i; j < Math.min(i + BATCH, COUNT); j++) {
    const r = rating();
    const tags = [...new Set(Array.from({ length: 1 + Math.floor(rand() * 3) }, () => pick(TAGS)))];
    docs.push({
      // One review per second from 2026-01-01T00:00:00Z: the ObjectId's timestamp is the creation
      // time, so a time window is an _id range, e.g. {_id: {$gte: ObjectId.createFromTime(t0)}}.
      _id: ObjectId((BASE_TS + j).toString(16) + j.toString(16).padStart(16, "0")),
      review: `${pick(OPENERS)} ${pick(BODIES[r])}. ${pick(BODIES[r])}.`,
      rating: r,
      tags,
      verified: rand() < 0.7
    });
  }
  db.reviews.insertMany(docs, { ordered: false });
}
print(`store.reviews: ${db.reviews.countDocuments()} documents`);
