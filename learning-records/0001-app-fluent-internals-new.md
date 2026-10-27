# Fluent at the application level, new to the engine

Marcos uses MongoDB fluently from application code: indexes, compound indexes, CRUD, aggregation. The internals are new to them, though. In the diagnostic they knew only that WiredTiger is the default engine and that documents travel as BSON (2/6 basics). They honestly skipped 17 questions, including all intermediate and hard ones. Teach the engine from first principles, and bridge from things they already use (indexes, explain) to the internal mechanism.

**Evidence:** lesson 0001 results: Basics 2/6, Intermediate 0/7, Hard 0/7. Q1 ✓, Q2 ✓, Q15 ✗ (readConcern "majority"), everything else "don't know". No free-recall answers were submitted.

**Implications:** Q15 was a wrong answer, not a skip, so they may hold a misconception about majority reads (e.g. "reads a quorum of nodes"). Probe this when we reach replication. Re-ask the diagnostic questions later as spaced retrieval, once each topic has been taught.
