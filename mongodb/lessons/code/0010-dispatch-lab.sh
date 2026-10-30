#!/usr/bin/env bash
# Lesson 0010 lab: deadlines (maxTimeMS), killOp, and what happens when a query never yields.
#
# Usage (from the mongodb/ folder, after lab steps 1-2 of the lesson have seeded store.reviews):
#   bash lessons/code/0010-dispatch-lab.sh            # uses container lab10-m1
#   bash lessons/code/0010-dispatch-lab.sh my-mongo   # or another container name
#
# Runs mongosh inside the container with `docker exec`, so you need no local mongosh.
# Every query is the lesson's example filter {review: /battery/i}, tagged with a comment so
# $currentOp and the slow-query log can find it. Takes about a minute.

set -euo pipefail
C="${1:-lab10-m1}"
msh() { docker exec "$C" mongosh store --quiet --eval "$1"; }
RUN=$(date +%s)   # tags this run's comments, so log lines from earlier runs are ignored
FILTER='{review: /battery/i}'

echo "== 1. maxTimeMS on one command (countDocuments = one aggregate, scans everything)"
msh "for (const ms of [500, 1000, 2000]) {
  const t = Date.now();
  try { db.reviews.countDocuments($FILTER, {maxTimeMS: ms, comment: 'lab10-deadline-$RUN'}); print(ms, 'finished?') }
  catch (e) { print('maxTimeMS', ms, '->', e.codeName, e.code, 'after', Date.now() - t, 'ms') } }"

echo
echo "== 2. maxTimeMS on a find cursor: a budget of server time across find + getMores"
msh "const t = Date.now(); let n = 0;
  try { const c = db.reviews.find($FILTER).maxTimeMS(1000).comment('lab10-find-$RUN');
        while (c.hasNext()) { c.next(); n++ } }
  catch (e) { print(e.codeName, 'after', n, 'documents; the shell waited', Date.now() - t, 'ms') }"
echo "server time per command (from the slow-query log):"
docker logs --since 60s "$C" 2>&1 | grep '"Slow query"' | grep "lab10-find-$RUN" | python3 -c '
import sys, json
total = 0
for line in sys.stdin:
    a = json.loads(line)["attr"]; total += a["durationMillis"]
    print("  ", next(iter(a["command"])), a["durationMillis"], "ms", a.get("errName", ""))
print("   total server time:", total, "ms")'

echo
echo "== 3. killOp from a second shell, after 1.5 s"
msh "const t = Date.now();
  try { db.reviews.countDocuments($FILTER, {comment: 'lab10-runaway-$RUN'}); print('shell 1: finished') }
  catch (e) { print('shell 1:', e.codeName, e.code, 'at', Date.now(), '(ran', Date.now() - t, 'ms)') }" &
sleep 1.5
msh "const op = db.getSiblingDB('admin').aggregate([{\$currentOp: {}},
      {\$match: {'command.comment': 'lab10-runaway-$RUN'}}]).toArray()[0];
  print('shell 2: opid', op.opid, 'secs_running', op.secs_running, op.planSummary, 'numYields', op.numYields, op.appName);
  db.killOp(op.opid); print('shell 2: killOp returned at', Date.now());"
wait

echo
echo "== 4. Same two tests with interrupt checks pushed to every 5 s (LAB ONLY, never in production)"
msh "db.adminCommand({setParameter: 1, internalQueryExecYieldPeriodMS: 5000})" >/dev/null
msh "const t = Date.now();
  try { const n = db.reviews.countDocuments($FILTER, {maxTimeMS: 500, comment: 'lab10-noyield-$RUN'}); print('maxTimeMS 500 -> finished anyway after', Date.now() - t, 'ms, n =', n) }
  catch (e) { print(e.codeName, 'after', Date.now() - t, 'ms') }"
msh "const t = Date.now();
  try { const n = db.reviews.countDocuments($FILTER, {comment: 'lab10-noyield-kill-$RUN'}); print('shell 1: finished anyway at', Date.now(), 'after', Date.now() - t, 'ms, n =', n) }
  catch (e) { print('shell 1:', e.codeName, 'at', Date.now()) }" &
sleep 1
msh "const a = db.getSiblingDB('admin'); const op = a.aggregate([{\$currentOp: {}},
      {\$match: {'command.comment': 'lab10-noyield-kill-$RUN'}}]).toArray()[0];
  db.killOp(op.opid); print('shell 2: killOp returned at', Date.now());
  sleep(500); const o = a.aggregate([{\$currentOp: {}}, {\$match: {opid: op.opid}}]).toArray()[0];
  if (o) print('shell 2: 0.5 s later: killPending', o.killPending, 'numYields', o.numYields);"
wait
msh "db.adminCommand({setParameter: 1, internalQueryExecYieldPeriodMS: 10})" >/dev/null
echo "(internalQueryExecYieldPeriodMS reset to 10)"

echo
echo "== 5. The slow-query log lines for the tests above"
docker logs --since 120s "$C" 2>&1 | grep '"Slow query"' | grep -E "lab10-(deadline|runaway|noyield|noyield-kill)-$RUN" | python3 -c '
import sys, json
for line in sys.stdin:
    a = json.loads(line)["attr"]
    print("  ", a["command"]["comment"], {k: a[k] for k in ("durationMillis", "planSummary", "numYields", "errCode", "errName") if k in a})'
