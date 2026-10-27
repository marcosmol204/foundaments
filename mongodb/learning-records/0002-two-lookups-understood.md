# Understands the two-lookup model (index → RecordId → document)

Marcos can map `explain()` stages to engine work: IXSCAN = seek and range scan in the index table, FETCH = one collection seek per RecordId, covered = no FETCH. They also connected Q3 to performance on their own, asking for the "cover your hot queries" practice. B-tree page vocabulary (leaf, internal, root, depth) did *not* land the first time: the two-tree diagram came before the single-tree basics. A step-by-step section (2b) was added to lesson 0002.

**Evidence:** lesson 0002 quiz 7/8 (Q1–Q5, Q7, Q8 ✓). Q6 ✗: counting `.wt` files (one per collection + one per index). They also skipped this question in the diagnostic (Q8 there).

**Implications:** Re-test file/ident counting in lesson 0003's quiz. Check that the leaf/internal vocabulary stuck before relying on it for cache and eviction (pages are the unit the cache moves).
