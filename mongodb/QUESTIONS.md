# Asked questions

Questions you asked along the way, filed by lesson. Try to answer each one from memory before opening the answer.

## General

## Lesson 0001 · Diagnostic

## Lesson 0002 · Two lookups

### Q: Why does a covered query run faster than the same query with a projection, and when should you make one?
_2026-10-25 · [lesson 2 §3b](lessons/0002-two-lookups.html#s3b)_

<details><summary>Answer</summary>

A covered query takes every filtered and returned field from one index, so the plan has no `FETCH` and no collection seeks (`totalDocsExamined: 0`). A projection that still returns `_id` keeps the `FETCH`, so it only saves network bytes. On 200k reviews with `{verified: 1, rating: 1}`: 44 ms / 15.6 MB with `FETCH`, 31 ms / 1.6 MB covered with `{_id: 0, rating: 1}`. Cover only your hottest queries, because each index is another B-tree that every insert has to update. ([Query optimization](https://www.mongodb.com/docs/manual/core/query-optimization/))

</details>

### Q: Where does the journal fit relative to a collection's B-tree?
_2026-10-25 · [lesson 2 §2b](lessons/0002-two-lookups.html#s2b)_

<details><summary>Answer</summary>

It's not part of any B-tree. The `.wt` B-tree files are the organised copy of the data, written consistently at each checkpoint (every 60 s). The journal is a separate append-only log of changes since the last checkpoint, synced every 100 ms. After a crash, WiredTiger starts from the last checkpoint and replays the journal. ([Journaling](https://www.mongodb.com/docs/manual/core/journaling/))

</details>

## Lesson 0002.1 · B-trees, deep dive

## Lesson 0003 · The cache
