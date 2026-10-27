# Mission: MongoDB Internals Mastery

## Why
Marcos is a full-stack (backend-leaning) developer who wants to understand MongoDB from the engine up, so they can run it confidently in production, make sharper architecture decisions, and explain how it works to others.

## Success looks like
- Diagnose a production symptom (latency spikes, replication lag, stalled migrations) by naming the internal mechanism behind it and the metric that proves it
- Trace one write end to end: driver → wire protocol (OP_MSG) → transport → command dispatch → storage API → WiredTiger cache, journal and checkpoint → oplog → secondaries
- Defend a design choice (shard key, write/read concern, schema shape) in terms of the engine's behaviour
- Teach any layer of the stack to a teammate, with a diagram, from memory
- Navigate the `mongodb/mongo` and WiredTiger source to answer "how does it really do X?"

## Constraints
- Order: storage engine & architectural decisions first → transport/wire layer → the layers built on the engine (query, replication, sharding, transactions)
- Practice modes: in-browser quizzes, hands-on with a local `mongod` (Docker), and guided source-code reading

## Out of scope
- Basic CRUD/driver tutorials (already a working backend developer)
