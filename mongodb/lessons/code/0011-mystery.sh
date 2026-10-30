#!/usr/bin/env bash
# Lesson 0011 lab: the mystery. One app, one query, one hidden fault in hops 1-4. You diagnose it.
#
# The app ("reviews-api") runs our query in a loop: db.reviews.find({rating: {$gte: 4}}).limit(20),
# 8 workers, Node.js driver 7.7.0, maxPoolSize 10, serverSelectionTimeoutMS 5000.
# `load` runs it for 30 s and prints what an APM would show: app time split into checkout wait,
# command time (wire + server) and the rest (server selection), plus driver events.
#
# Usage (from the mongodb/ folder; needs only Docker):
#   bash lessons/code/0011-mystery.sh setup      # 3-node replica set lab11-m1..m3 + app container (~2 min)
#   bash lessons/code/0011-mystery.sh load       # baseline: run the app 30 s, read its time split
#   bash lessons/code/0011-mystery.sh inject     # arm ONE random fault (it stays secret)
#   bash lessons/code/0011-mystery.sh load       # the symptom
#   bash lessons/code/0011-mystery.sh evidence   # server-side metrics for hops 2-4, per member
#   bash lessons/code/0011-mystery.sh reveal     # which fault was it?
#   bash lessons/code/0011-mystery.sh heal       # undo the fault (then inject again)
#   bash lessons/code/0011-mystery.sh teardown   # remove containers and network
# `inject <name>` arms a named fault instead: pool | storm | failover | regex | network.
#
# Lab-only settings, so the faults fit on a laptop: net.maxIncomingConnections 400 (with 127.0.0.1
# exempt, so `docker exec ... mongosh` always gets in), slow-query log of every operation sampled at 5%,
# 1,000,000 seeded reviews and a {rating: 1} index. Host ports 27210-27212 map to m1-m3.

set -euo pipefail
NET=lab11
APP=lab11-app
STATE="${TMPDIR:-/tmp}/lab11-fault"
MEMBERS="lab11-m1 lab11-m2 lab11-m3"

msh() { docker exec "$1" mongosh --quiet --eval "$2"; }
primary() {   # name of the container that is primary now (asks any member that answers)
  for c in $MEMBERS; do
    p=$(docker exec "$c" mongosh --quiet --eval 'try { const p = rs.status().members.find(m => m.stateStr === "PRIMARY"); print(p ? p.name.split(":")[0] : "") } catch (e) { print("") }' 2>/dev/null || true)
    [ -n "$p" ] && { echo "lab11-$p"; return; }
  done
  echo ""
}
wait_primary() {  # wait until $1 (or anyone) is primary
  for _ in $(seq 1 60); do
    p=$(primary); { [ -n "$p" ] && { [ -z "${1:-}" ] || [ "$p" = "$1" ]; }; } && return 0; sleep 2
  done
  echo "no primary after 120 s" >&2; return 1
}
profile_all() {
  for c in $MEMBERS; do
    msh "$c" 'db.getSiblingDB("store").setProfilingLevel(0, {slowms: 0, sampleRate: 0.05})' >/dev/null 2>&1 || true
  done
}

write_app() {
docker exec -i "$APP" sh -c 'cat > /app/lab.js' <<'EOF'
// Lesson 0011 mystery: the app, and the "noise" processes the faults start.
//   node lab.js app [seconds]   reviews-api: 8 workers × find({rating: {$gte: 4}}).limit(20)
//   node lab.js storm           recs-service: a new deploy, 40 instances × minPoolSize 10
//   node lab.js search          admin-search: 16 workers × countDocuments({review: /battery/i}), no maxTimeMS
const { MongoClient } = require('mongodb');
const fs = require('fs');
const URI = 'mongodb://m1,m2,m3/?replicaSet=rs0';
const mode = process.argv[2] || 'app';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const f = x => Number.isFinite(x) ? (x < 10 ? x.toFixed(1) : Math.round(x).toLocaleString('en-US')) : '-';

async function app() {
  const SECS = Number(process.argv[3] || 30), WORKERS = 8;
  let features = {};
  try { features = JSON.parse(fs.readFileSync('/app/features.json', 'utf8')); } catch {}
  const opts = { appName: 'reviews-api', maxPoolSize: 10, serverSelectionTimeoutMS: 5000, monitorCommands: true };
  let c = new MongoClient(URI, opts);
  const t0 = Date.now(), at = () => `+${((Date.now() - t0) / 1000).toFixed(1)} s`;
  const checkout = [], command = [], appT = [], events = [];
  const buckets = {};
  let created = 0, cleared = 0;
  const listen = c => {
    // Attribute each checkout and command to our find (not to the export, which shares the pool).
    const lastCheckout = new Map(), ours = new Set();
    c.on('connectionCheckedOut', e => lastCheckout.set(e.connectionId, e.durationMS));
    c.on('commandStarted', e => {
      if (e.commandName !== 'find' || e.databaseName !== 'store' || e.command.filter?.review) return;
      ours.add(e.requestId); checkout.push(lastCheckout.get(e.connectionId) ?? 0);
    });
    c.on('commandSucceeded', e => { if (ours.delete(e.requestId)) command.push(e.duration); });
    c.on('commandFailed', e => { if (ours.delete(e.requestId)) command.push(e.duration); });
    c.on('connectionCreated', () => created++);
    c.on('connectionPoolCleared', e => { cleared++; events.push(`${at()} pool cleared ${e.address}`); });
    c.on('serverDescriptionChanged', e => { if (Date.now() - t0 > 2000 && e.previousDescription.type !== e.newDescription.type) events.push(`${at()} ${e.address} ${e.previousDescription.type} -> ${e.newDescription.type}`); });
  };
  listen(c);
  // Startup: connect first, like a service does before it takes traffic. If that fails,
  // the "pod" restarts and tries again, until the run's time is up.
  let attempt = 0;
  for (;;) {
    const s = performance.now();
    try { attempt++; await c.connect(); break; }
    catch (e) {
      console.log(`startup attempt ${attempt} failed after ${f(performance.now() - s)} ms: ${e.name}: ${String(e.message).slice(0, 80)}`);
      if (Date.now() - t0 > SECS * 1000) { console.log('the app never started: 0 requests served'); process.exit(0); }
      await c.close().catch(() => {}); c = new MongoClient(URI, opts); listen(c);
    }
  }
  const coll = c.db('store').collection('reviews');
  const errors = {};
  let stop = false, ok = 0;
  const worker = async () => {
    while (!stop) {
      const s = performance.now();
      try { await coll.find({ rating: { $gte: 4 } }).limit(20).toArray(); ok++; }
      catch (e) { const k = `${e.name}: ${String(e.message).slice(0, 90)}`; errors[k] = (errors[k] || 0) + 1; }
      const d = performance.now() - s; appT.push(d);
      const b = Math.floor((Date.now() - t0) / 5000); (buckets[b] = buckets[b] || []).push(d);
      await sleep(10);
    }
  };
  // Feature flag: the CSV export of positive reviews mentioning a refund, on the same MongoClient.
  const exporter = async () => { while (!stop) { try { await coll.find({ rating: { $gte: 4 }, review: /refund/ }).toArray(); } catch {} } };
  const all = [...Array.from({ length: WORKERS }, worker), ...(features.csvExport ? Array.from({ length: 12 }, exporter) : [])];
  await sleep(SECS * 1000); stop = true; await Promise.all(all);
  console.log(`reviews-api, ${SECS} s, ${WORKERS} workers, find({rating: {$gte: 4}}).limit(20), maxPoolSize 10`);
  console.log(`ops ok ${ok.toLocaleString('en-US')}, errors ${Object.values(errors).reduce((a, b) => a + b, 0)}`);
  for (const [k, n] of Object.entries(errors)) console.log(`  ${n} × ${k}`);
  console.log(`                         p50      p99      max   (ms)`);
  const row = (name, xs) => console.log(`${name.padEnd(22)} ${f(pct(xs, 0.5)).padStart(6)}  ${f(pct(xs, 0.99)).padStart(7)}  ${f(xs.length ? xs.reduce((a, b) => Math.max(a, b)) : NaN).padStart(7)}`);
  row('app sees', appT); row('checkout wait', checkout); row('command (wire+server)', command);
  // Means per app operation (an op that never got a server has no checkout and no command).
  const sum = xs => xs.reduce((a, b) => a + b, 0), n = Math.max(appT.length, 1);
  const m = { app: sum(appT) / n, co: sum(checkout) / n, cmd: sum(command) / n };
  const other = Math.max(m.app - m.co - m.cmd, 0);
  console.log(`mean per op: app ${f(m.app)} = checkout ${f(m.co)} + command ${f(m.cmd)} + other ${f(other)} (selection, driver)`);
  console.log('p99 per 5 s: ' + Object.keys(buckets).map(b => `${b * 5}s ${f(pct(buckets[b], 0.99))}`).join(' | '));
  console.log(`driver events: connections created ${created}, pool cleared ${cleared}`);
  for (const e of events) console.log('  ' + e);
  const rtt = [...c.topology.description.servers].map(([a, d]) => `${a.split(':')[0]} ${d.type} rtt ${f(d.roundTripTime)} ms`);
  console.log('topology at end: ' + rtt.join(' · '));
  await c.close();
}

async function storm() {
  const clients = Array.from({ length: 40 }, () => new MongoClient(URI, { appName: 'recs-service', minPoolSize: 10, serverSelectionTimeoutMS: 60000 }));
  await Promise.allSettled(clients.map(c => c.connect()));
  console.log('recs-service: 40 instances connected (minPoolSize 10)');
  for (;;) await sleep(60000);
}

async function search() {
  const c = new MongoClient(URI, { appName: 'admin-search', maxPoolSize: 100 });
  const coll = c.db('store').collection('reviews');
  await Promise.all(Array.from({ length: 64 }, async () => { for (;;) { try { await coll.countDocuments({ review: /battery/i }); } catch { await sleep(500); } } }));
}

({ app, storm, search })[mode]().catch(e => { console.error(e); process.exit(1); });
EOF
}

case "${1:-}" in
setup)
  docker network inspect $NET >/dev/null 2>&1 || docker network create $NET >/dev/null
  i=0
  for c in $MEMBERS; do
    h=${c#lab11-}
    docker run -d --name "$c" --hostname "$h" --network $NET -m 1g -p "$((27210 + i)):27017" mongo:8.0 sh -c '
      printf "%s\n" "net:" "  bindIpAll: true" "  maxIncomingConnections: 400" \
        "  maxIncomingConnectionsOverride: [\"127.0.0.1/32\"]" "  reservedAdminThreads: 2" \
        "replication:" "  replSetName: rs0" > /tmp/mongod.yaml
      exec mongod --config /tmp/mongod.yaml' >/dev/null
    i=$((i + 1))
  done
  sleep 6
  msh lab11-m1 'rs.initiate({_id: "rs0", members: [{_id: 0, host: "m1:27017", priority: 2}, {_id: 1, host: "m2:27017"}, {_id: 2, host: "m3:27017"}]})' >/dev/null
  wait_primary lab11-m1
  docker cp lessons/code/seed-reviews.js lab11-m1:/seed-reviews.js
  echo "seeding 1,000,000 reviews (about a minute)..."
  docker exec lab11-m1 mongosh store --quiet --eval 'const N = 1000000' --file /seed-reviews.js
  msh lab11-m1 'db.getSiblingDB("store").reviews.createIndex({rating: 1})' >/dev/null
  profile_all
  docker run -d --name $APP --network $NET -m 512m node:22-alpine sleep infinity >/dev/null
  docker exec $APP sh -c 'mkdir -p /app && cd /app && npm i -s mongodb@7.7.0 >/dev/null 2>&1'
  write_app
  echo "ready. Next: bash lessons/code/0011-mystery.sh load"
  ;;
load)
  f=$(cat "$STATE" 2>/dev/null || true)
  if [ "$f" = "failover" ]; then   # the crash happens 8 s into this run
    ( sleep 8; docker kill lab11-m1 >/dev/null 2>&1 ) &
    echo "failover-fired" > "$STATE"
  fi
  write_app   # refresh the app code from this script
  docker exec -e NODE_PATH=/app/node_modules $APP node /app/lab.js app "${2:-30}"
  wait
  ;;
inject)
  [ -s "$STATE" ] && { echo "a fault is already armed; run heal first" >&2; exit 1; }
  faults=(pool storm failover regex network)
  f=${2:-${faults[$((RANDOM % 5))]}}
  case $f in
    pool)     docker exec $APP sh -c 'echo "{\"csvExport\": true}" > /app/features.json' ;;
    storm)    docker exec -d -e NODE_PATH=/app/node_modules $APP node /app/lab.js storm; sleep 8 ;;
    failover) : ;;   # fires during the next `load`
    regex)    docker exec -d -e NODE_PATH=/app/node_modules $APP node /app/lab.js search; sleep 3 ;;
    network)  docker run --rm --cap-add NET_ADMIN --net container:lab11-m1 alpine:3.20 \
                sh -c 'apk add -q iproute2-tc && tc qdisc add dev eth0 root netem delay 40ms' ;;
    *) echo "unknown fault $f" >&2; exit 1 ;;
  esac
  echo "$f" > "$STATE"
  echo "a fault is armed. Run: bash lessons/code/0011-mystery.sh load"
  ;;
evidence)
  p=$(primary)
  echo "== replica set (asked any member that answers)"
  for c in $MEMBERS; do
    if docker exec "$c" true 2>/dev/null; then
      msh "$c" 'const s = rs.status(); print(s.members.map(m => m.name.split(":")[0] + " " + m.stateStr + (m.health ? "" : " (unreachable)")).join(" · "))' 2>/dev/null && break
    fi
  done
  echo "== per member: serverStatus().connections, and 'Connection refused' log lines in the last 60 s"
  for c in $MEMBERS; do
    if ! docker exec "$c" true 2>/dev/null; then echo "$c: container not running"; continue; fi
    refused=$(docker logs --since 60s "$c" 2>&1 | grep -c 'Connection refused because there are too many' || true)
    msh "$c" "const x = db.serverStatus().connections; print('$c current ' + x.current + ' available ' + x.available + ' active ' + x.active + ' rejected ' + x.rejected + ' totalCreated ' + x.totalCreated + ' · refused/60s $refused')" || true
  done
  if [ -n "$p" ]; then
    echo "== primary $p: client connections by appName, active or idle (\$currentOp idleConnections)"
    msh "$p" 'db.getSiblingDB("admin").aggregate([{$currentOp: {allUsers: true, idleConnections: true}}, {$match: {client: {$exists: true}}},
      {$group: {_id: {$ifNull: ["$appName", "(none)"]}, conns: {$sum: 1}, active: {$sum: {$cond: ["$active", 1, 0]}}}}, {$sort: {conns: -1}}]).forEach(g => print("  " + g._id + ": " + g.conns + " connections, " + g.active + " active"))'
    echo "== primary $p: active client operations by appName (\$currentOp)"
    msh "$p" 'db.getSiblingDB("admin").aggregate([{$currentOp: {allUsers: true}}, {$match: {active: true, client: {$exists: true}, ns: /^store\./}},
      {$group: {_id: "$appName", ops: {$sum: 1}, plans: {$addToSet: "$planSummary"}, maxSecs: {$max: "$secs_running"}, maxTimeMS: {$addToSet: "$command.maxTimeMS"}}}]).forEach(g => print("  " + g._id + ": " + g.ops + " running, plan " + g.plans.join(",") + ", max secs_running " + g.maxSecs + ", maxTimeMS set: " + (g.maxTimeMS.length ? g.maxTimeMS.join(",") : "none")))'
    echo "== primary $p: slow-query log, finds on store.reviews in the last 60 s (5% sample), by appName and filter shape"
    docker logs --since 60s "$p" 2>&1 | grep '"Slow query"' | grep '"find":"reviews"' | python3 -c '
import sys, json, collections
g = collections.defaultdict(lambda: ([], [], []))
for line in sys.stdin:
    a = json.loads(line)["attr"]
    key = a.get("appName", "(no appName)") + " {" + ", ".join(a["command"].get("filter", {}).keys()) + "} " + a.get("planSummary", "")
    d, w, q = g[key]
    d.append(a["durationMillis"]); w.append(a.get("workingMillis", a["durationMillis"]))
    q.append(a.get("queues", {}).get("execution", {}).get("totalTimeQueuedMicros", 0) / 1000)
p = lambda xs, f: sorted(xs)[min(len(xs) - 1, int(f * len(xs)))]
for key, (d, w, q) in g.items():
    print(f"  {key}: {len(d)} lines · durationMillis p50 {p(d, .5)} p99 {p(d, .99)} · workingMillis p50 {p(w, .5)} p99 {p(w, .99)} · execution queue ms p99 {p(q, .99):.1f}")
if not g: print("  (no lines)")'
  else
    echo "== no primary right now"
  fi
  ;;
reveal)
  f=$(cat "$STATE" 2>/dev/null || true); echo "the fault was: ${f%-fired}"
  ;;
heal)
  f=$(cat "$STATE" 2>/dev/null || true); f=${f%-fired}
  case $f in
    pool)     docker exec $APP rm -f /app/features.json ;;
    storm)    docker exec $APP pkill -f 'lab.js storm' || true; sleep 3 ;;
    regex)    docker exec $APP pkill -f 'lab.js search' || true ;;
    network)  docker run --rm --cap-add NET_ADMIN --net container:lab11-m1 alpine:3.20 \
                sh -c 'apk add -q iproute2-tc && tc qdisc del dev eth0 root' ;;
    failover) docker start lab11-m1 >/dev/null; echo "waiting for m1 to take the primary back..."; wait_primary lab11-m1; profile_all ;;
  esac
  rm -f "$STATE"
  echo "healed (${f:-nothing to heal})"
  ;;
teardown)
  docker rm -f $APP $MEMBERS >/dev/null 2>&1 || true
  docker network rm $NET >/dev/null 2>&1 || true
  rm -f "$STATE"
  ;;
*)
  sed -n '2,24p' "$0"; exit 1 ;;
esac
