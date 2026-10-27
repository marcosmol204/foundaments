# WiredTiger page model is solid; B-tree split mechanics are not yet

Marcos got all 5 WiredTiger questions in lesson 2.1 right: leaf-only data, no-overwrite blocks, insert skip lists, reconciliation, and file counting. File counting had been missed twice before (diagnostic Q8, lesson 0002 Q6), so that gap is now closed. They missed both questions about how a B-tree grows. On a split of a full non-root leaf, the median moves up and the height stays the same. Height only grows when the root splits.

**Evidence:** lesson 0002.1 quiz, btree 2/4 · wiredtiger 5/5. Q3 ✗ (non-root leaf split), Q4 ✗ (when height increases). It isn't yet known which wrong options were picked. A likely misconception is "any split adds a level".

**Implications:** The split rule doesn't block the cache lesson (0003), which only needs page vocabulary. Re-test it as spaced retrieval in a later quiz (e.g. lesson 0004), using the `reviews` data. If it misses again, run a predict-then-insert exercise in `assets/btree-viz.js`.
