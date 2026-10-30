# Asked questions

Questions you asked along the way, filed by lesson. Try to answer each one from memory before opening the answer.

## General

## Lesson 0001 · Diagnostic

## Lesson 0002 · Two lookups

### Q: Why does a covered query run faster than the same query with a projection, and when should you make one?
_2026-10-25 · [lesson 2 §3b](lessons/0002-two-lookups.html#s3b)_

<details><summary>Answer</summary>

A covered query takes every filtered and returned field from one index, so the plan has no `FETCH` and no collection seeks (`totalDocsExamined: 0`). A projection that still returns `_id` keeps the `FETCH`, so it only saves network bytes. On 200k reviews with `{verified: 1, rating: 1}`: 44 ms / 15.6 MiB with `FETCH`, 31 ms / 1.6 MiB covered with `{_id: 0, rating: 1}`. Cover only your hottest queries, because each index is another B-tree that every insert has to update. ([Query optimization](https://www.mongodb.com/docs/manual/core/query-optimization/))

</details>

### Q: Where does the journal fit relative to a collection's B-tree?
_2026-10-25 · [lesson 2 §2b](lessons/0002-two-lookups.html#s2b)_

<details><summary>Answer</summary>

It's not part of any B-tree. The `.wt` B-tree files are the organised copy of the data, written consistently at each checkpoint (every 60 s). The journal is a separate append-only log of changes since the last checkpoint, synced every 100 ms. After a crash, WiredTiger starts from the last checkpoint and replays the journal. ([Journaling](https://www.mongodb.com/docs/manual/core/journaling/))

</details>

## Lesson 0002.1 · B-trees, deep dive

### Q: WiredTiger supports row-store and column-store B-trees. Which one does MongoDB use for collections and indexes?
_2026-10-25 · /btw · [lesson 2.1](lessons/0002-1-btrees.html)_

<details><summary>Answer</summary>

Row-store, for both. A collection is a row-store table keyed by RecordId (`key_format=q`, a 64-bit integer) whose value is the BSON document (`value_format=u`, raw bytes). An index is a row-store table whose key is the encoded index key (`key_format=u`). Verified on 8.0 with `db.reviews.stats({indexDetails: true})` → `creationString`. Column-store (`WT_BTREE_COL_VAR`) keys records by a record number and isn't what MongoDB uses for collections. ([WT B-trees](https://source.wiredtiger.com/develop/arch-btree.html))

</details>

### Q: What does the `->` syntax mean in C?
_2026-10-27 · /btw · [lesson 2.1 Part 2](lessons/0002-1-btrees.html)_

<details><summary>Answer</summary>

`p->field` reads a struct member through a pointer. It is shorthand for `(*p).field`: follow the pointer, then take the field. In `btree.c`, `x->keys[i]` means "the `keys` array of the node that `x` points to". You use `.` when you have the struct itself, and `->` when you have its address. ([cppreference: member access](https://en.cppreference.com/w/c/language/operator_member_access))

</details>

### Q: Does MongoDB (WiredTiger) use a B-tree or a B+-tree?
_2026-10-27 · /btw · [lesson 2.1 Part 3 §1](lessons/0002-1-btrees.html)_

<details><summary>Answer</summary>

A B+-tree in the sense that matters: "the root and internal pages only store keys and references to other pages, while leaf pages store keys and values." Every lookup ends at a leaf, and a range scan reads only leaves. Unlike the textbook C tree from lesson 2.1, no data lives in internal pages. WiredTiger's own docs just call it a "B-tree". ([WT B-trees](https://source.wiredtiger.com/develop/arch-btree.html), [Comer 1979](https://users.cs.utah.edu/~pandey/courses/cs6530/fall24/papers/trees/p121-comer.pdf))

</details>

### Q: On a row-store leaf page, why is the key count "half the number of physical entries", except when the "all empty values" flag is set?
_2026-10-27 · /btw · [lesson 2.1 Part 3 §2](lessons/0002-1-btrees.html)_

<details><summary>Answer</summary>

The page header's `entries` counts **cells**, and a leaf normally stores each record as two cells: a key cell and a value cell. So keys = entries ÷ 2. But a zero-length value isn't physically stored at all. If *every* value on the page is empty (`WT_PAGE_EMPTY_V_ALL`), there's one cell per key, so keys = entries. If only some values are empty, there's no simple rule. These are the checks WiredTiger's page verifier makes. ([bt_vrfy_dsk.c](https://github.com/wiredtiger/wiredtiger/blob/develop/src/btree/bt_vrfy_dsk.c), [btmem.h](https://github.com/wiredtiger/wiredtiger/blob/develop/src/include/btmem.h))

</details>

### Q: What is the connection between a "block" and a "page"?
_2026-10-27 · /btw · [lesson 2.1 Part 3 §2 and §4](lessons/0002-1-btrees.html)_

<details><summary>Answer</summary>

A **page** is a B-tree node: a root, internal or leaf page. It exists in memory (in the cache) and as a disk image. A **block** is where the block manager stores a page's disk image inside the `.wt` file: page header + block header + (compressed) cells, plus a checksum. Reading a page means reading its block. Writing a dirty page means reconciling it into a new image and writing it to a **new** block, never over the old one. So: page = what the B-tree thinks in; block = where that page sits on disk. ([WT data file](https://source.wiredtiger.com/develop/arch-data-file.html), [WT block manager](https://source.wiredtiger.com/develop/arch-block.html))

</details>

### Q: Trace the reads for `db.reviews.find({_id: id})`, from query to document: which trees, pages, blocks and headers are touched?
_2026-10-27 · /btw · [lesson 2 §2c](lessons/0002-two-lookups.html), [lesson 2.1 Part 3 §2](lessons/0002-1-btrees.html)_

<details><summary>Answer</summary>

1. The plan is `EXPRESS_IXSCAN` on `_id_` (8.0 fast path, verified: 1 key, 1 doc examined).
2. **Index tree:** root → internal → leaf. For each page: if it's in the cache, use it. If not, take the child's address (offset, size, checksum) from the parent's address cell, read that block, check the checksum, read the uncompressed headers, decompress the rest, and build the in-memory page.
3. In the leaf, binary-search for the `_id` key → get the RecordId.
4. **Collection tree:** same walk, keyed by RecordId, down to the leaf holding the BSON review.

Two seeks, each a few page hops. Usually only leaves miss the cache, because root and internal pages are hot. ([WT cache](https://source.wiredtiger.com/develop/arch-cache.html), [block.h](https://github.com/wiredtiger/wiredtiger/blob/develop/src/include/block.h))

</details>

### Q: Deleting data doesn't shrink `.wt` files. So what *does* give disk space back?
_2026-10-27 · /btw · [lesson 2.1 Part 3 §4](lessons/0002-1-btrees.html)_

<details><summary>Answer</summary>

- **`compact`** (or background **`autoCompact`**): moves blocks so that free space ends up at the end of the file, then releases it to the OS. It doesn't block CRUD, but it can slow checkpoints and add latency. Run `{compact: "reviews", dryRun: true}` (8.0+) first to estimate the gain.
- **Dropping** a collection or index deletes its `.wt` file.
- **Initial sync** of a replica set member rebuilds its files from scratch, without the free space.

Without these, the freed blocks stay in the file on the *avail* list and get reused for new writes. ([compact](https://www.mongodb.com/docs/manual/reference/command/compact/), [WT block manager](https://source.wiredtiger.com/develop/arch-block.html))

</details>

## Lesson 0003 · The cache
