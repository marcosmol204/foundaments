# MongoDB Internals Resources

## Knowledge

### Storage engine (WiredTiger)
- [Docs: WiredTiger Storage Engine (MongoDB Manual 9.0)](https://www.mongodb.com/docs/manual/core/wiredtiger/)
  Official overview: document-level concurrency, tickets, MVCC snapshots, 60 s checkpoints, compression defaults, cache sizing formula. Use for: verified numbers and defaults.
- [Docs: Journaling (MongoDB Manual)](https://www.mongodb.com/docs/manual/core/journaling/)
  100 ms journal sync, `j: true`, ~100 MB journal files, recovery = last checkpoint + journal replay. Use for: durability questions.
- [Source: Storage Engine API README (`src/mongo/db/storage/README.md`)](https://github.com/mongodb/mongo/blob/master/src/mongo/db/storage/README.md)
  How the server talks to the engine: RecordStore, SortedDataInterface, RecoveryUnit, WriteUnitOfWork, idents, WriteConflictException, startup recovery, oplog visibility. Use for: the seam between MongoDB and WiredTiger. **Primary source for the engine phase.**
- [WiredTiger Architecture Guide](https://source.wiredtiger.com/develop/arch-index.html)
  Engine-level design docs: snapshots, transactions, timestamps, B-trees, cache, eviction, checkpoint, history store, logging, rollback-to-stable. Caveat: not updated in lockstep with code. Use for: deep dives below the storage API.
- [Blog: WiredTiger logging and checkpoint mechanism (Percona)](https://www.percona.com/blog/wiredtiger-logging-and-checkpoint-mechanism/)
  Practitioner walkthrough of the journal and checkpoints, including dirty-cache-triggered checkpoints. Use for: production-flavoured intuition.

### Transport & wire protocol
- [Docs: MongoDB Wire Protocol (Manual 9.0)](https://www.mongodb.com/docs/manual/reference/mongodb-wire-protocol/)
  MsgHeader, OP_MSG (flagBits, sections kind 0/1, CRC-32C), OP_COMPRESSED, legacy opcodes removed in 5.1. Use for: byte-level protocol work.
- [Spec: OP_MSG (MongoDB Specifications)](https://specifications.readthedocs.io/en/latest/message/OP_MSG/)
  The driver-facing spec with design rationale. Use for: why OP_MSG replaced the legacy opcodes.
- [Source: Transport README (`src/mongo/transport`)](https://github.com/mongodb/mongo/tree/master/src/mongo/transport)
  Session → ServiceEntryPoint → SessionWorkflow; exhaust and fire-and-forget commands. Use for: server-side ingress path.
- [Source: server design docs (`docs/`)](https://github.com/mongodb/mongo/tree/master/docs)
  Command dispatch, egress networking, batons, thread pools, futures/promises. Use for: how a request is scheduled and dispatched.

### Replication & consistency
- [Source: Replication Internals README (`src/mongo/db/repl/README.md`)](https://github.com/mongodb/mongo/blob/master/src/mongo/db/repl/README.md)
  Oplog fetching (pull), sync sources, idempotent oplog entries, PV1 elections (Raft-based), commit point, read concern, transactions. Use for: everything replication.
- [Paper: "Fault-Tolerant Replication with Pull-Based Consensus in MongoDB" (Zhou & Mu, NSDI '21)](https://www.usenix.org/conference/nsdi21/presentation/zhou)
  How MongoDB's Raft variant pulls instead of pushes. Use for: rigorous consensus discussion.
- [Paper: "Tunable Consistency in MongoDB" (Schultz, Avitabile, Cabral, PVLDB 2019)](https://doi.org/10.14778/3352063.3352125)
  Read/write concern design, speculative execution, rollback. Use for: defending consistency choices.
- [Jepsen: MongoDB 4.2.6 analysis (2020)](https://jepsen.io/analyses/mongodb-4.2.6)
  Independent testing of transactions; shows where defaults weaken guarantees. Use for: critical thinking about isolation claims.

### Sharding
- [Docs: Sharded Cluster Balancer (Manual)](https://www.mongodb.com/docs/manual/core/sharding-balancer-administration/)
  Balancer on CSRS primary, 128 MB range size, 3× threshold, migration steps, jumbo chunks. Use for: migration behaviour.

## Wisdom (Communities)
- [r/mongodb](https://www.reddit.com/r/mongodb/)
  Since Sept 2025 MongoDB routes architecture and best-practice discussion here ([announcement](https://www.mongodb.com/community/forums/t/announcing-changes-to-the-mongodb-community-forum/329093)). Use for: design critiques, production war stories.
- [Stack Overflow `[mongodb]` tag](https://stackoverflow.com/questions/tagged/mongodb)
  Use for: concrete, code-specific questions.
- [MongoDB Community Hub (user groups, Champions)](https://www.mongodb.com/community/forums/)
  Use for: finding a local MongoDB User Group to present internals talks (mission: teach others).

## Gaps
- No authoritative doc yet on the **ingress thread model** (thread-per-connection vs. async executors) for current versions. Search `docs/thread_pools.md` and `service_executor*` before teaching it.
- Need a trusted source on the **query engine (SBE vs classic)** and plan cache.
- ~~WiredTiger in-memory page structure~~: covered in lesson 2.1 via btmem.h. Still missing: authoritative source on hazard-pointer mechanics (only glossary + Jira so far).

### B-trees (added 2026-10-25)
- [Paper: Douglas Comer, "The Ubiquitous B-Tree", ACM Computing Surveys 11(2), 1979 (PDF mirror, Univ. of Utah course)](https://users.cs.utah.edu/~pandey/courses/cs6530/fall24/papers/trees/p121-comer.pdf)
  Classic survey: why B-trees, balance, B+-tree variant. Use for: first-principles motivation. Original: Bayer & McCreight, "Organization and maintenance of large ordered indexes", Acta Informatica 1(3), 1972.
- WiredTiger arch guide pages: [Row/Column](https://source.wiredtiger.com/develop/arch-row-column.html), [Data file format](https://source.wiredtiger.com/develop/arch-data-file.html), [Block manager](https://source.wiredtiger.com/develop/arch-block.html) (no-overwrite, extent lists), [Cache](https://source.wiredtiger.com/develop/arch-cache.html) (read-in, reconciliation), [Glossary](https://source.wiredtiger.com/develop/arch-glossary.html).
- [Source: `src/include/btmem.h` (WiredTiger)](https://github.com/wiredtiger/wiredtiger/blob/develop/src/include/btmem.h)
  In-memory structs: WT_REF states, WT_ROW, WT_INSERT skip lists, WT_UPDATE chains. Use for: source-reading exercises.
- WiredTiger Jira (e.g. [WT-486](https://jira.mongodb.org/browse/WT-486), [WT-12860](https://jira.mongodb.com/browse/WT-12860)): real eviction/hazard-pointer issues. Use for: production war stories.

### Cache & eviction (added 2026-10-26)
- [WiredTiger Architecture Guide: Cache](https://source.wiredtiger.com/develop/arch-cache.html) and [Eviction](https://source.wiredtiger.com/develop/arch-eviction.html)
  In-memory vs. on-disk page format, clean vs. dirty eviction, reconciliation, approximate LRU (oldest third of candidates), when application threads are forced to evict. Use for: lesson 3 and any cache-pressure diagnosis.
- [WiredTiger API: `WT_CONNECTION` config](https://source.wiredtiger.com/develop/struct_w_t___c_o_n_n_e_c_t_i_o_n.html)
  Default eviction thresholds: target 80, trigger 95, dirty target 5, dirty trigger 20; updates target/trigger default to half the dirty ones. Use for: exact threshold numbers.
- [Source: `wiredtiger_kv_engine.cpp` (r8.0.4), wiredtiger_open config](https://github.com/mongodb/mongo/blob/r8.0.4/src/mongo/db/storage/wiredtiger/wiredtiger_kv_engine.cpp#L384)
  What MongoDB actually passes to WiredTiger: cache_size, 4 eviction threads, optional dirty target/trigger overrides. Use for: "which WT defaults does MongoDB change?"
