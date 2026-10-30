// Lesson 0012 lab: plan selection, the plan cache and replanning on store.reviews.
// Usage (after seeding 500,000 reviews, see the lesson):
//   docker cp lessons/code/0012-query-lab.js lab12:/0012-query-lab.js
//   docker exec lab12 mongosh store --quiet --file /0012-query-lab.js
const r = db.getSiblingDB("store").reviews;
r.createIndex({ verified: 1, rating: 1 }); r.createIndex({ rating: 1 }); r.createIndex({ tags: 1 });

const ent = () => r.aggregate([{ $planCacheStats: {} }]).toArray().map(e => ({
  active: e.isActive, works: e.works.low,
  plan: (JSON.stringify(e.cachedPlan).match(/"indexName":"[^"]+"/g) || []).join() }));

print("== 1. multi-planning: three candidates race");
const q = { verified: true, rating: { $gte: 4 }, tags: "battery" };
const e = r.find(q).explain("allPlansExecution");
print("winner:", e.queryPlanner.winningPlan.inputStage.indexName, "| rejected:", e.queryPlanner.rejectedPlans.length);
e.executionStats.allPlansExecution.forEach(p => print(" ", p.executionStages.inputStage.indexName || p.executionStages.indexName, "returned", p.nReturned, "in", p.executionStages.works, "works"));

print("== 2. cache entry lifecycle (inactive -> active), same shape with other constants");
r.getPlanCache().clear();
for (let i = 1; i <= 3; i++) { r.find(q).toArray(); print(" run", i, JSON.stringify(ent())); }
r.find({ verified: false, rating: { $gte: 2 }, tags: "price" }).toArray();
print(" other constants -> entries:", ent().length);

print("== 3. replanning: cache a plan on a narrow _id range, then run the wide one");
const oid = s => ObjectId.createFromTime(1767225600 + s);
const sel = x => ({ _id: { $gte: x }, rating: 1, verified: false, tags: "sound" });
r.getPlanCache().clear(); db.setProfilingLevel(2);
for (const [name, f] of [["narrow", sel(oid(499900))], ["narrow", sel(oid(499900))], ["narrow", sel(oid(499900))],
                         ["wide", sel(oid(0))], ["wide", sel(oid(0))], ["wide", sel(oid(0))]]) {
  r.find(f).comment("lab12-" + name).toArray(); print(" ", name, JSON.stringify(ent()));
}
db.setProfilingLevel(0);
db.system.profile.find({ "command.comment": /lab12/, "command.find": "reviews" },
  { _id: 0, comment: "$command.comment", millis: 1, keysExamined: 1, replanned: 1, replanReason: 1, fromPlanCache: 1, planSummary: 1 })
  .forEach(x => print(" ", JSON.stringify(x)));
