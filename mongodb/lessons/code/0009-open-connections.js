// Lesson 0009 lab: open N idle connections to a mongod, like a fleet of app pools would.
// Each connection does what a driver does on a new pooled connection, then sits idle:
//   1. hello (with client metadata, so mongod logs "client metadata")
//   2. one query: store.reviews.find({rating: {$gte: 4}}).limit(1)
//   3. nothing. The socket stays open until the script exits.
// No npm packages: raw TCP sockets and a tiny BSON encoder, so it runs in a plain node image.
//
// Usage (from the mongodb/ folder, with the lab9 network and lab9-mongod running):
//   docker run --rm -it --name lab9-client --network lab9 -v "$PWD/lessons/code":/code:ro \
//     node:22-alpine node /code/0009-open-connections.js mongod:27017 1000 120
// Args: host:port (default mongod:27017), N connections (default 1000), seconds to hold (default 120).
// It prints "READY n=<open> failed=<refused>" when all N attempts are done, then holds them and closes them all at the end.
"use strict";
const net = require("net");

const [hostPort = "mongod:27017", nArg = "1000", holdArg = "120"] = process.argv.slice(2);
const [host, portStr] = hostPort.split(":");
const port = Number(portStr || 27017), N = Number(nArg), HOLD = Number(holdArg);

// ---- minimal BSON: string, int32, double, bool, document (no arrays needed here) ----
function cstr(s) { return Buffer.concat([Buffer.from(s, "utf8"), Buffer.from([0])]); }
function encode(doc) {
  const parts = [];
  for (const [k, v] of Object.entries(doc)) {
    if (typeof v === "string") {
      const s = Buffer.from(v, "utf8"), len = Buffer.alloc(4); len.writeInt32LE(s.length + 1);
      parts.push(Buffer.from([0x02]), cstr(k), len, s, Buffer.from([0]));
    } else if (typeof v === "boolean") {
      parts.push(Buffer.from([0x08]), cstr(k), Buffer.from([v ? 1 : 0]));
    } else if (typeof v === "number" && Number.isInteger(v)) {
      const b = Buffer.alloc(4); b.writeInt32LE(v); parts.push(Buffer.from([0x10]), cstr(k), b);
    } else if (typeof v === "number") {
      const b = Buffer.alloc(8); b.writeDoubleLE(v); parts.push(Buffer.from([0x01]), cstr(k), b);
    } else if (typeof v === "object") {
      parts.push(Buffer.from([0x03]), cstr(k), encode(v));
    }
  }
  const body = Buffer.concat(parts), out = Buffer.alloc(4);
  out.writeInt32LE(body.length + 5);
  return Buffer.concat([out, body, Buffer.from([0])]);
}

// OP_MSG: 16-byte header, flagBits = 0, one kind-0 section (lesson 6 §2, lesson 8).
let nextId = 1;
function opMsg(cmd) {
  const body = encode(cmd), hdr = Buffer.alloc(21);
  hdr.writeInt32LE(21 + body.length, 0); hdr.writeInt32LE(nextId++, 4);
  hdr.writeInt32LE(0, 8); hdr.writeInt32LE(2013, 12); hdr.writeUInt32LE(0, 16); hdr[20] = 0;
  return Buffer.concat([hdr, body]);
}

// The same metadata shape a driver sends in its first hello (the handshake spec).
const metadata = {
  application: { name: "lab9-reviews-app" },
  driver: { name: "lab9-raw-sockets", version: "1.0" },
  os: { type: "Linux" },
  platform: "Node.js " + process.version
};

function openOne() {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port });
    let buf = Buffer.alloc(0), step = 0;
    sock.on("error", reject);
    sock.on("close", () => reject(new Error("closed by server")));  // e.g. over maxIncomingConnections
    sock.on("connect", () => sock.write(opMsg({ hello: 1, client: metadata, $db: "admin" })));
    sock.on("data", d => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 4 && buf.length >= buf.readInt32LE(0)) {
        buf = buf.subarray(buf.readInt32LE(0));            // one full reply; we don't parse it
        step++;
        if (step === 1) sock.write(opMsg({ find: "reviews", filter: { rating: { $gte: 4 } }, limit: 1, $db: "store" }));
        if (step === 2) resolve(sock);                     // idle from here on
      }
    });
  });
}

(async () => {
  const socks = [], t0 = Date.now();
  let failed = 0;
  for (let i = 0; i < N; i += 100) {                       // open in waves of 100
    const wave = [];
    for (let j = i; j < Math.min(N, i + 100); j++) wave.push(openOne());
    for (const r of await Promise.allSettled(wave)) r.status === "fulfilled" ? socks.push(r.value) : failed++;
  }
  console.log(`READY n=${socks.length} failed=${failed} in ${Date.now() - t0} ms; holding ${HOLD} s`);
  await new Promise(r => setTimeout(r, HOLD * 1000));
  for (const s of socks) s.end();
  console.log("CLOSED");
  setTimeout(() => process.exit(0), 500);
})().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
