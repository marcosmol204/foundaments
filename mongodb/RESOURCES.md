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

- [Spec: Wire Compression / OP_COMPRESSED (MongoDB Specifications)](https://specifications.readthedocs.io/en/latest/compression/OP_COMPRESSED/)
  `compression` field in the hello handshake, the client's first matching compressor wins, the 9-byte OP_COMPRESSED header, compressor ids 0–3, and the never-compressed list (hello, sasl*, authenticate, createUser, updateUser…). Use for: compression questions.
- Source (r8.0.34): [`rpc/op_msg.cpp`](https://github.com/mongodb/mongo/blob/r8.0.34/src/mongo/rpc/op_msg.cpp#L152-L257) (`OpMsg::parse`: flag mask, section kinds, at most 2 sequences, CRC-32C), [`transport/session_workflow.cpp`](https://github.com/mongodb/mongo/blob/r8.0.34/src/mongo/transport/session_workflow.cpp#L321-L363) (makeExhaustMessage; the reply uses the request's compressor), [`transport/message_compressor_manager.cpp`](https://github.com/mongodb/mongo/blob/r8.0.34/src/mongo/transport/message_compressor_manager.cpp#L72-L124), [`message_compressor_options_server.idl`](https://github.com/mongodb/mongo/blob/r8.0.34/src/mongo/transport/message_compressor_options_server.idl#L33-L38) (default `snappy,zstd,zlib`), [`service_entry_point_common.cpp`](https://github.com/mongodb/mongo/blob/r8.0.34/src/mongo/db/service_entry_point_common.cpp#L2299-L2332) (moreToCome → no reply; NotWritablePrimary closes the connection). Use for: source-reading exercises on hop 2 (lesson 8).

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
- ~~ingress thread model~~: closed in lesson 0009 from the r8.0.34 source (dedicated thread per connection; `docs/thread_pools.md` covers internal pools only).
- ~~query engine / plan cache~~: closed in lesson 0012 from `src/mongo/db/query/README.md` (r8.0.34) plus `multi_plan.cpp`, `cached_plan.cpp`, `trial_period_utils.cpp`. Still missing: a trusted source on how `trySbeRestricted` decides which shapes use SBE.
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

### Durability (added 2026-10-27)
- WiredTiger arch guide pages: [Checkpoint](https://source.wiredtiger.com/develop/arch-checkpoint.html), [Logging](https://source.wiredtiger.com/develop/arch-logging.html), [Metadata](https://source.wiredtiger.com/develop/arch-metadata.html) (turtle file), [Timestamps](https://source.wiredtiger.com/develop/arch-timestamp.html), [Rollback to Stable](https://source.wiredtiger.com/develop/arch-rts.html). Use for: lesson 5 and crash-recovery questions.
- [Source: `journal_flusher.h`](https://github.com/mongodb/mongo/blob/r8.0.4/src/mongo/db/storage/control/journal_flusher.h), [`checkpointer.cpp`](https://github.com/mongodb/mongo/blob/r8.0.4/src/mongo/db/storage/checkpointer.cpp), [`WiredTigerUtil::useTableLogging`](https://github.com/mongodb/mongo/blob/r8.0.4/src/mongo/db/storage/wiredtiger/wiredtiger_util.cpp#L1015-L1048) (r8.0.4)
  The 100 ms flusher and its grouping, the 60 s checkpoint loop, and why replica set user tables aren't journaled (only `local`/oplog). Use for: "when is my write durable?"

### Concurrency & MVCC (added 2026-10-27)
- WiredTiger arch guide: [Snapshots](https://source.wiredtiger.com/develop/arch-snapshot.html) (min/max/concurrent IDs, the 4-step visibility rule), [Transactions](https://source.wiredtiger.com/develop/arch-transaction.html) (update chains, read/oldest/stable timestamps), [History Store](https://source.wiredtiger.com/develop/arch-hs.html) (old versions moved out at reconciliation). Use for: lesson 4 and any MVCC question.
- [Docs: Concurrency FAQ (MongoDB Manual)](https://www.mongodb.com/docs/manual/faq/concurrency/) and [Production Considerations for transactions](https://www.mongodb.com/docs/manual/core/transactions-production-consideration/)
  Lock modes (IS/IX/S/X, shown as r/w/R/W), intent locks only for CRUD; 60 s transaction lifetime, write conflicts between transactions and plain writes, cache-pressure aborts. Use for: lock and transaction behaviour.
- Source: [`exception_util.h` (r8.0.4)](https://github.com/mongodb/mongo/blob/r8.0.4/src/mongo/db/concurrency/exception_util.h) (`writeConflictRetry`: unlimited retries with backoff, not inside a WUOW), [`wiredtiger_util.cpp` (r8.0.4)](https://github.com/mongodb/mongo/blob/r8.0.4/src/mongo/db/storage/wiredtiger/wiredtiger_util.cpp#L214) (WT_ROLLBACK → WriteConflict / TemporarilyUnavailable / TransactionTooLargeForCache), WiredTiger [`txn_inline.h`](https://github.com/wiredtiger/wiredtiger/blob/develop/src/include/txn_inline.h) (`__txn_modify_block`, the write-conflict check). Use for: source-reading exercises on conflicts.

### Write path, end to end (added 2026-10-27)
- [Source: Catalog README (`src/mongo/db/catalog/README.md`, r8.0.34)](https://github.com/mongodb/mongo/blob/r8.0.34/src/mongo/db/catalog/README.md#writeunitofwork)
  WriteUnitOfWork, "Collection and Index Writes" (record + index keys in one storage transaction), Oplog Visibility (no-holes point). Use for: what one write commits atomically.
- [Docs: Write Concern (Manual 9.0)](https://www.mongodb.com/docs/manual/reference/write-concern/)
  Implicit default `w: "majority"`, `writeConcernMajorityJournalDefault`, "includes or implies j: true causes an immediate journal synchronization", wtimeout. Use for: what each write concern waits for.
- Driver specs: [Server Selection](https://specifications.readthedocs.io/en/latest/server-selection/server-selection/), [Connection Monitoring and Pooling (CMAP)](https://specifications.readthedocs.io/en/latest/connection-monitoring-and-pooling/connection-monitoring-and-pooling/), [Retryable Writes](https://specifications.readthedocs.io/en/latest/retryable-writes/retryable-writes/). Use for: the client side of hop 1 (lesson 6), and Phase 2.
- [Source: Sessions and transactions README (`src/mongo/db/s/README_sessions_and_transactions.md`)](https://github.com/mongodb/mongo/blob/r8.0.34/src/mongo/db/s/README_sessions_and_transactions.md)
  Why retryable-write oplog entries carry `lsid`, `txnNumber`, `stmtId`, `prevOpTime`, and the `config.transactions` record. Use for: reading oplog entries.

### Ingress & thread model (added 2026-10-30)
- [Source: `session_workflow.cpp` (r8.0.34)](https://github.com/mongodb/mongo/blob/r8.0.34/src/mongo/transport/session_workflow.cpp#L879), [`asio_session_manager.cpp`](https://github.com/mongodb/mongo/blob/r8.0.34/src/mongo/transport/asio/asio_session_manager.cpp#L75), [`service_executor.cpp`](https://github.com/mongodb/mongo/blob/r8.0.34/src/mongo/transport/service_executor.cpp#L169), [`service_executor_utils.cpp`](https://github.com/mongodb/mongo/blob/r8.0.34/src/mongo/transport/service_executor_utils.cpp#L72)
  The 8.0 thread model: every client connection gets a dedicated thread (synchronous/"passthrough" executor, 1 MiB stack); reserved executor only for exempt clients over the limit; source → process → sink loop. Use for: "which thread runs my connection?"
- [Source: `session_manager_common.cpp` (r8.0.34)](https://github.com/mongodb/mongo/blob/r8.0.34/src/mongo/transport/session_manager_common.cpp#L103)
  Effective connection limit = min(maxConns, 80% of nofile/2, 20% memory ÷ 16 KiB pre-auth buffer cap); "Connection accepted/refused/ended" log lines. Use for: connection-limit questions.
- Source IDLs (r8.0.34): [`transport_options.idl`](https://github.com/mongodb/mongo/blob/r8.0.34/src/mongo/transport/transport_options.idl) (ingressConnectionEstablishment*, capMemoryConsumptionForPreAuthBuffers, maxIncomingConnectionsOverride), [`ingress_admission_control.idl`](https://github.com/mongodb/mongo/blob/r8.0.34/src/mongo/db/admission/ingress_admission_control.idl), [`ingress_request_rate_limiter.idl`](https://github.com/mongodb/mongo/blob/r8.0.34/src/mongo/db/admission/ingress_request_rate_limiter.idl), [`server_options_general.idl`](https://github.com/mongodb/mongo/blob/r8.0.34/src/mongo/db/server_options_general.idl#L87) (hidden yaml options reservedAdminThreads, maxIncomingConnectionsOverride). Use for: ingress defaults and throttles.
- [Docs: Tuning Your Connection Pool Settings (Manual 9.0)](https://www.mongodb.com/docs/manual/tutorial/connection-pool-performance-tuning/)
  Pool-size symptoms and the "app servers × maxPoolSize per mongod" calculation. Use for: sizing pools across instances.
- [Spec: MongoDB Handshake](https://specifications.readthedocs.io/en/latest/mongodb-handshake/handshake/)
  The client metadata a driver sends in its first hello (what the "client metadata" log line shows). Use for: identifying which app owns connections.

### Driver: pool, monitoring, selection (added 2026-10-30)
- Driver specs: [Server Monitoring](https://specifications.readthedocs.io/en/latest/server-discovery-and-monitoring/server-monitoring/) (streaming hello with topologyVersion/maxAwaitTimeMS, the extra RTT socket, dedicated unauthenticated monitoring sockets, serverMonitoringMode) and [SDAM](https://specifications.readthedocs.io/en/latest/server-discovery-and-monitoring/server-discovery-and-monitoring/) (error handling: mark Unknown + clear the pool on network errors; clear only for "node is shutting down", not for "not writable primary"). Use for: lesson 7 and failover behaviour.
- [Source: Node.js driver v7.7.0](https://github.com/mongodb/node-mongodb-native/tree/v7.7.0/src): `connection_string.ts` (defaults), `cmap/connection_pool.ts` (`processWaitQueue`, the maxConnecting loop), `cmap/connect.ts` (handshake document), `cmap/auth/scram.ts` (speculativeAuthenticate, PBKDF2 cache), `sdam/monitor.ts` (streaming, RTTPinger, no credentials), `sdam/topology.ts` (power-of-two selection), `timeout.ts` (checkout timeout). Use for: what one real driver does by default.
- [Source: Execution Control README (`src/mongo/db/admission/README.md`, r8.0.34)](https://github.com/mongodb/mongo/blob/r8.0.34/src/mongo/db/admission/README.md)
  Throughput probing: how 8.0 adjusts the number of read/write tickets. Use for: the server-side queue that `durationMillis − workingMillis` shows.
- Docs: [replSetStepDown](https://www.mongodb.com/docs/manual/reference/command/replSetStepDown/) (doesn't close all client connections, nominates a secondary, kills in-progress writes) and [Replica set elections](https://www.mongodb.com/docs/manual/core/replica-set-elections/) (electionTimeoutMillis 10 s). Use for: planned vs. crash failover.

### Command dispatch & interruption (added 2026-10-30)
- [Source: `docs/command_dispatch.md` + `service_entry_point_common.cpp` (r8.0.34)](https://github.com/mongodb/mongo/blob/r8.0.34/src/mongo/db/service_entry_point_common.cpp#L1628)
  handleRequest → parseCommand → findCommand → `_parseCommand` → `_initiateCommand` (auth, then the maxTimeMS deadline, then read-concern defaults) → `_commandExec` → completeOperation (slow log). Use for: hop 4, step by step.
- [Source: `operation_context.cpp` `checkForInterruptNoAssert` (r8.0.34)](https://github.com/mongodb/mongo/blob/r8.0.34/src/mongo/db/operation_context.cpp#L220), [`kill_op.cpp`](https://github.com/mongodb/mongo/blob/r8.0.34/src/mongo/db/commands/kill_op.cpp), [`plan_yield_policy.h`](https://github.com/mongodb/mongo/blob/r8.0.34/src/mongo/db/query/plan_yield_policy.h#L215), [`getmore_cmd.cpp` leftover maxTime](https://github.com/mongodb/mongo/blob/r8.0.34/src/mongo/db/commands/getmore_cmd.cpp#L305), [`default_max_time_ms_cluster_parameter.cpp`](https://github.com/mongodb/mongo/blob/r8.0.34/src/mongo/db/default_max_time_ms_cluster_parameter.cpp#L36)
  Cooperative interruption: a kill or deadline only sets a flag, which is checked at yield points (10 ms timer). Use for: "why didn't my kill or maxTimeMS work?"
- [Spec: Client Side Operations Timeout (CSOT)](https://specifications.readthedocs.io/en/latest/client-side-operations-timeout/client-side-operations-timeout/)
  `timeoutMS` covers server selection, checkout and all getMores in wall-clock time; the driver appends maxTimeMS = remaining time − minRTT. Use for: client-side timeouts.
- Docs (Manual 9.0): [killOp](https://www.mongodb.com/docs/manual/reference/command/killOp/), [cursor.maxTimeMS](https://www.mongodb.com/docs/manual/reference/method/cursor.maxTimeMS/), [$currentOp](https://www.mongodb.com/docs/manual/reference/operator/aggregation/currentOp/), [Terminate Running Operations](https://www.mongodb.com/docs/manual/tutorial/terminate-running-operations/), [Atomicity](https://www.mongodb.com/docs/manual/core/write-operations-atomicity/). Use for: operator procedures and kill semantics.

### Latency split (added 2026-10-30)
- [Spec: Command Logging and Monitoring](https://specifications.readthedocs.io/en/latest/command-logging-and-monitoring/command-logging-and-monitoring/)
  `commandStarted`/`Succeeded`/`Failed` events; duration runs from send to reply and may include BSON encoding and decoding. Use for: the driver-side "command duration" in a latency split.
- [Source: `CurOp::_sumBlockedTimeTotal` + `workingMillis` (`curop.cpp`, r8.0.34)](https://github.com/mongodb/mongo/blob/r8.0.34/src/mongo/db/curop.cpp#L568)
  `workingMillis` = `durationMillis` − lock waits − execution-ticket queueing − flow control. Use for: separating waiting from working in hop 4 (lesson 11).

### Query engine (added 2026-10-30)
- [Source: Query System Internals README (`src/mongo/db/query/README.md`)](https://github.com/mongodb/mongo/blob/r8.0.34/src/mongo/db/query/README.md)
  Phases from parsing to execution; classic vs SBE plan caches; works, inactive entries, replanning. Use for: lesson 12 and any plan-cache question.
- Source (r8.0.34): [`exec/multi_plan.cpp`](https://github.com/mongodb/mongo/blob/r8.0.34/src/mongo/db/exec/multi_plan.cpp#L241), [`exec/cached_plan.cpp`](https://github.com/mongodb/mongo/blob/r8.0.34/src/mongo/db/exec/cached_plan.cpp#L104), [`exec/trial_period_utils.cpp`](https://github.com/mongodb/mongo/blob/r8.0.34/src/mongo/db/exec/trial_period_utils.cpp). Use for: trial limits (10,000 works or 30% of the collection, 101 results) and the replan limit (10× works).
- Replication steady state (lesson 13): [`repl/README.md` r8.0.34, steady state](https://github.com/mongodb/mongo/blob/r8.0.34/src/mongo/db/repl/README.md#steady-state-replication) (OplogFetcher, OplogWriter, OplogApplier, sync source selection); [Docs: oplog size](https://www.mongodb.com/docs/manual/core/replica-set-oplog/). Use for: lag and oplog window questions.
- Elections and rollback (lesson 14): [`repl/README.md` r8.0.34: Elections, Commit Point Propagation, Rollback: Recover to a Timestamp](https://github.com/mongodb/mongo/blob/r8.0.34/src/mongo/db/repl/README.md#elections). Use for: failover timing and what rollback keeps.
- Sharding (lesson 15): [`db/s/README.md` r8.0.34](https://github.com/mongodb/mongo/blob/r8.0.34/src/mongo/db/s/README.md) and its siblings [`README_balancer.md`](https://github.com/mongodb/mongo/blob/r8.0.34/src/mongo/db/s/README_balancer.md), [`README_migrations.md`](https://github.com/mongodb/mongo/blob/r8.0.34/src/mongo/db/s/README_migrations.md), [`README_range_deleter.md`](https://github.com/mongodb/mongo/blob/r8.0.34/src/mongo/db/s/README_range_deleter.md). Use for: routing, balancing by data size, migration critical section, orphans. Still missing: a primary source on mongos routing for queries (targeting logic) and shard-key design guidance beyond the manual.
