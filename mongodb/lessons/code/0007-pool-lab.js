// Lesson 0007 lab: the driver's side of hop 1 (server selection, connection pool, monitoring).
// Node.js driver 7.7.0 against a 3-node replica set (m1, m2, m3) seeded with store.reviews.
//
// Usage (from the mongodb/ folder, with the lab7 replica set from the lesson running):
//   docker run -d --name lab7-node --network lab7 -m 512m -v "$PWD/lessons/code":/code node:22-alpine sleep infinity
//   docker exec lab7-node sh -c 'cd /tmp && npm i -s mongodb@7.7.0'
//   docker exec -e NODE_PATH=/tmp/node_modules lab7-node node /code/0007-pool-lab.js <experiment> [arg]
//
// Experiments:
//   monitor     watch heartbeats and RTT for 25 s, then count the client's sockets per server
//   pool [N]    40 concurrent slow finds with maxPoolSize N (default 5): checkout wait vs. command time
//   burst [K]   100 concurrent fast finds on a cold client with maxConnecting K (default 2)
//   timeout     the same pile-up with waitQueueTimeoutMS: 200: what the app sees
//   failover    step the primary down under load and watch the driver move its pool
//   failover kill   the same, but you `docker kill lab7-m1` from the host when told (a crash)
//   nearest     3,000 finds with readPreference nearest: how the latency window spreads them
//   connect     time to establish one pooled connection (set MONGO_URI to try auth / TLS)
//
// MONGO_URI defaults to mongodb://m1,m2,m3/?replicaSet=rs0. Every run sets appName "lab7-<experiment>",
// so you can find its connections in $currentOp on the server.

const { MongoClient } = require('mongodb');
const exp = process.argv[2] || 'monitor';
const arg = Number(process.argv[3]);
const URI = process.env.MONGO_URI || 'mongodb://m1,m2,m3/?replicaSet=rs0';

// The slow version of our query: positive reviews that mention "refund".
// No review contains that word, so the server scans all 200,000 documents (~75 ms) and returns none.
const SLOW = { rating: { $gte: 4 }, review: /refund/ };
const FAST = { rating: { $gte: 4 } };

const sleep = ms => new Promise(r => setTimeout(r, ms));
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
const ms = x => Math.round(x * 10) / 10;
const summary = (name, xs) => console.log(`${name.padEnd(22)} p50 ${ms(pct(xs, 0.5))} ms   p95 ${ms(pct(xs, 0.95))} ms   max ${ms(Math.max(...xs))} ms`);

function client(opts = {}) {
  return new MongoClient(URI, { appName: `lab7-${exp}`, monitorCommands: true, ...opts });
}

// Count this app's sockets as each member sees them. The observer uses its own appName,
// so its connections don't show up in the counts.
async function serverView(label) {
  console.log(`\n${label}: sockets with appName lab7-${exp}, as each member's $currentOp shows them`);
  const rows = [];
  for (const host of ['m1', 'm2', 'm3']) {
    const obs = new MongoClient(`mongodb://${host}:27017/?directConnection=true`, { appName: 'lab7-observer' });
    const ops = await obs.db('admin').aggregate([
      { $currentOp: { allUsers: true, idleConnections: true } },
      { $match: { appName: `lab7-${exp}` } },
      { $project: { _id: 0, client: 1, desc: 1, active: 1, command: 1 } }
    ]).toArray();
    for (const o of ops) rows.push({ member: host, client: o.client, active: o.active, cmd: o.command ? Object.keys(o.command)[0] : '(idle)', maxAwaitTimeMS: o.command?.maxAwaitTimeMS });
    const conns = (await obs.db('admin').command({ serverStatus: 1 })).connections;
    console.log(`  ${host} serverStatus().connections:`, { current: conns.current, active: conns.active, totalCreated: conns.totalCreated });
    await obs.close();
  }
  console.table(rows);
}

async function monitor() {
  const c = client();
  const beats = [];
  c.on('serverHeartbeatSucceeded', e => beats.push({ t: Date.now(), host: e.connectionId, awaited: e.awaited, ms: e.duration }));
  const t0 = Date.now();
  await c.connect();
  await c.db('store').collection('reviews').findOne(FAST);
  await sleep(25000);
  console.log('Heartbeats in 25 s (awaited = streaming hello that waited on the server):');
  for (const b of beats) console.log(`  +${String(b.t - t0).padStart(5)} ms  ${b.host}  awaited=${b.awaited}  ${ms(b.ms)} ms`);
  console.log('\nServer descriptions (roundTripTime comes from the RTT pinger, not from the awaited hellos):');
  for (const [addr, s] of c.topology.description.servers) console.log(`  ${addr}  ${s.type.padEnd(9)} rtt ${ms(s.roundTripTime)} ms`);
  await serverView('After 1 findOne');
  await c.close();
}

async function pool() {
  const N = arg || 5, OPS = 40;
  const c = client({ maxPoolSize: N });
  const waits = [], cmds = [], totals = [];
  let created = 0, started = 0;
  c.on('connectionCheckOutStarted', () => started++);
  c.on('connectionCheckedOut', e => waits.push(e.durationMS));
  c.on('connectionCreated', () => created++);
  c.on('commandSucceeded', e => { if (e.commandName === 'find') cmds.push(e.duration); });
  await c.connect();
  const coll = c.db('store').collection('reviews');
  await coll.findOne(FAST); // warm one connection
  waits.length = 0; cmds.length = 0; started = 0;
  const obs = new MongoClient('mongodb://m1:27017/?directConnection=true', { appName: 'lab7-observer' });
  await obs.connect();
  const t0 = performance.now();
  const run = Promise.all(Array.from({ length: OPS }, async () => {
    const s = performance.now();
    await coll.find(SLOW).toArray();
    totals.push(performance.now() - s);
  }));
  await sleep(300); // look at both sides of hop 1 in the middle of the pile-up
  const queued = started - waits.length;
  const [{ n } = { n: 0 }] = await obs.db('admin').aggregate([
    { $currentOp: { allUsers: true } }, { $match: { appName: `lab7-${exp}`, 'command.find': 'reviews' } }, { $count: 'n' }]).toArray();
  await run; await obs.close();
  console.log(`${OPS} concurrent find({rating: {$gte: 4}, review: /refund/}) with maxPoolSize ${N}: wall ${ms(performance.now() - t0)} ms, connections created ${created}`);
  console.log(`  at +300 ms: ${queued} waiting in the driver's wait queue, ${n} finds running on m1 ($currentOp)`);
  summary('checkout wait', waits);
  summary('command (wire+server)', cmds);
  summary('app sees', totals);
  await c.close();
}

async function burst() {
  const K = arg || 2, OPS = 100;
  const c = client({ maxConnecting: K });
  let pending = 0, maxPending = 0, created = 0;
  const ready = [];
  c.on('connectionCreated', () => { created++; pending++; maxPending = Math.max(maxPending, pending); });
  c.on('connectionReady', e => { pending--; ready.push(e.durationMS); });
  await c.connect();
  const coll = c.db('store').collection('reviews');
  const totals = [];
  const t0 = performance.now();
  await Promise.all(Array.from({ length: OPS }, async () => {
    const s = performance.now();
    await coll.find(FAST).limit(1).toArray();
    totals.push(performance.now() - s);
  }));
  console.log(`${OPS} concurrent fast finds on a cold pool, maxConnecting ${K}: wall ${ms(performance.now() - t0)} ms`);
  console.log(`  connections created ${created}, max pending at once ${maxPending}`);
  summary('connection setup', ready);
  summary('app sees', totals);
  await c.close();
}

async function timeout() {
  const c = client({ maxPoolSize: 5, waitQueueTimeoutMS: 200 });
  const coll = c.db('store').collection('reviews');
  await coll.findOne(FAST);
  const res = await Promise.allSettled(Array.from({ length: 40 }, () => coll.find(SLOW).toArray()));
  const errs = {};
  for (const r of res) { const k = r.status === 'fulfilled' ? 'ok' : `${r.reason.name}: ${r.reason.message}`; errs[k] = (errs[k] || 0) + 1; }
  console.log('40 slow finds, maxPoolSize 5, waitQueueTimeoutMS 200:'); console.log(errs);
  await c.close();
}

async function failover() {
  // "failover"      sends replSetStepDown to the primary (a planned failover, like a rolling upgrade)
  // "failover kill" waits while you run `docker kill <primary container>` from the host (a crash)
  const kill = process.argv[3] === 'kill';
  const c = client({ maxPoolSize: 20 });
  const log = [];
  const t0 = Date.now();
  const note = (what, e = {}) => log.push(`+${String(Date.now() - t0).padStart(5)} ms  ${what}  ${e.address || ''}`);
  c.on('connectionPoolCleared', e => note('POOL CLEARED', e));
  c.on('serverDescriptionChanged', e => { if (e.previousDescription.type !== e.newDescription.type) note(`server ${e.previousDescription.type} -> ${e.newDescription.type}`, e); });
  const createdBy = {};
  c.on('connectionCreated', e => { createdBy[e.address] = (createdBy[e.address] || 0) + 1; });
  const coll = c.db('store').collection('reviews');
  await coll.findOne(FAST);
  let ok = 0, stop = false, slowest = 0;
  const errors = {};
  const workers = Array.from({ length: 20 }, async () => {
    while (!stop) {
      const s = performance.now();
      try { await coll.find(FAST).limit(5).toArray(); ok++; } catch (e) { errors[e.name] = (errors[e.name] || 0) + 1; }
      slowest = Math.max(slowest, performance.now() - s);
    }
  });
  await sleep(2000);
  const before = { ...createdBy };
  if (kill) { note('>>> kill the primary now'); console.log('>>> kill the primary now (docker kill lab7-m1)'); }
  else {
    note('stepDown sent');
    await c.db('admin').command({ replSetStepDown: 10, secondaryCatchUpPeriodSecs: 5 }).catch(e => note(`stepDown reply: ${e.codeName || e.message}`));
  }
  await sleep(kill ? 30000 : 15000);
  stop = true; await Promise.all(workers);
  console.log(log.join('\n'));
  console.log('\nconnections created per server, before:', before);
  console.log('connections created per server, at end:', createdBy);
  console.log(`finds ok ${ok}, errors`, errors, `slowest find ${ms(slowest)} ms (reads are retried once by default)`);
  await c.close();
}

async function nearest() {
  // Server selection with readPreference "nearest": which members get 3,000 finds?
  const names = {};
  for (const h of ['m1', 'm2', 'm3']) names[(await require('dns').promises.lookup(h)).address + ':27017'] = h;
  for (const localThresholdMS of [15, 0]) {
    const c = client({ readPreference: 'nearest', localThresholdMS });
    const by = {};
    c.on('commandStarted', e => { if (e.commandName === 'find') by[names[e.address] || e.address] = (by[names[e.address] || e.address] || 0) + 1; });
    const coll = c.db('store').collection('reviews');
    await coll.findOne(FAST); await sleep(1500); // let the RTT pinger take a few samples
    const rtt = [...c.topology.description.servers].map(([a, d]) => `${a} ${ms(d.roundTripTime)} ms`).join(', ');
    for (let i = 0; i < 100; i++) await Promise.all(Array.from({ length: 30 }, () => coll.find(FAST).limit(1).toArray()));
    console.log(`localThresholdMS ${localThresholdMS}: rtt ${rtt}`);
    console.log('  finds per member:', by);
    await c.close();
  }
}

async function connect() {
  const times = [];
  for (let i = 0; i < 20; i++) {
    const c = client({ maxPoolSize: 1 });
    c.on('connectionReady', e => times.push(e.durationMS));
    await c.db('store').collection('reviews').findOne(FAST);
    await c.close();
  }
  console.log(`URI ${URI.replace(/\/\/[^@]*@/, '//<user>@')}`);
  console.log(`first connection in this process: ${times[0]} ms`);
  summary('connection setup', times);
}

({ monitor, pool, burst, timeout, failover, nearest, connect })[exp]().catch(e => { console.error(e); process.exit(1); });
