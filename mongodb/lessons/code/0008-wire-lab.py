#!/usr/bin/env python3
"""Lesson 0008 lab: make the wire traffic that 0008-opmsg.py decodes.

Runs in a throwaway python container on the lab network, against mongod "m1"
(store.reviews seeded with seed-reviews.js, N = 250000). From the mongodb/ folder:

    docker run --rm --name lab8-py --network lab8-net -v "$PWD/lessons/code":/code python:3.12-slim \\
      sh -c 'pip install -q --root-user-action=ignore pymongo zstandard python-snappy && python /code/0008-wire-lab.py all'

Steps (pass one name instead of "all" to run just that one):
    batch     insert_many of 1,000 reviews, then of 250,000 (watch the driver split it)
    find      read one day of reviews (86,400) with no compression, snappy, zstd and zlib
    w0        a w:0 insert, then a w:0 duplicate-key insert that fails silently
    exhaust   an exhaust cursor (getMore replies with moreToCome)
    checksum  a raw-socket ping with checksumPresent, then one with a wrong checksum
    monitor   an idle client for 25 s: watch the streaming hello (exhaustAllowed)

It prints what the driver saw (time, counts). The bytes are in the capture.
"""
import socket
import struct
import sys
import time

import bson
from bson import ObjectId
from pymongo import MongoClient, CursorType, WriteConcern

HOST = "m1"
DAY = 1767225600  # 2026-01-01T00:00:00Z: seed-reviews.js writes one review per second from here


def client(**kw):
    return MongoClient(f"mongodb://{HOST}:27017/", appname="lab8", **kw)


def batch():
    c = client()
    src, dst = c.store.reviews, c.store.scratch
    docs = list(src.find({}, {"_id": 0}).limit(1000))
    dst.drop()
    t = time.perf_counter()
    r = dst.insert_many(docs)
    print(f"batch: insert_many 1,000 reviews -> {len(r.inserted_ids)} ids, {1000 * (time.perf_counter() - t):.0f} ms")

    docs = list(src.find({}, {"_id": 0}).limit(250000))
    dst.drop()
    t = time.perf_counter()
    r = dst.insert_many(docs)
    print(f"batch: insert_many {len(docs):,} reviews -> {len(r.inserted_ids):,} ids, {1000 * (time.perf_counter() - t):.0f} ms")
    dst.drop()


def find():
    day = {"_id": {"$gte": ObjectId.from_datetime(_dt(DAY)), "$lt": ObjectId.from_datetime(_dt(DAY + 86400))}}
    for comp in [None, "snappy", "zstd", "zlib"]:
        c = client(compressors=comp) if comp else client()
        coll = c.store.reviews
        coll.find_one()                      # warm up: connect, handshake, page the data in
        list(coll.find(day))
        best = None
        for _ in range(3):
            t = time.perf_counter()
            n = len(list(coll.find(day)))
            ms = 1000 * (time.perf_counter() - t)
            best = ms if best is None else min(best, ms)
        print(f"find: one day, compressors={comp or 'none'}: {n:,} reviews, best of 3 = {best:.0f} ms")
        c.close()


def w0():
    c = client()
    coll = c.store.get_collection("reviews", write_concern=WriteConcern(w=0))
    _id = ObjectId()
    doc = {"_id": _id, "review": "After two weeks battery lasts for days.", "rating": 5,
           "tags": ["battery", "quality"], "verified": True}
    r = coll.insert_one(doc)
    print(f"w0: insert_one acknowledged={r.acknowledged}")
    r = coll.insert_one(doc)                # same _id: a duplicate-key error nobody hears about
    print(f"w0: duplicate insert_one acknowledged={r.acknowledged}, no exception raised")
    time.sleep(0.2)
    print(f"w0: copies of that _id in the collection = {c.store.reviews.count_documents({'_id': _id})}")
    c.store.reviews.delete_one({"_id": _id})


def monitor():
    c = client()
    c.admin.command("ping")
    print("monitor: idle for 25 s while the driver's monitor streams hello replies")
    time.sleep(25)
    c.close()


def exhaust():
    c = client()
    day = {"_id": {"$lt": ObjectId.from_datetime(_dt(DAY + 3600))}}   # first hour: 3,600 reviews
    n = len(list(c.store.reviews.find(day, batch_size=1000, cursor_type=CursorType.EXHAUST)))
    print(f"exhaust: {n:,} reviews read with an exhaust cursor, batch_size 1000")


def checksum():
    """Hand-built OP_MSG {ping: 1, $db: "admin"} with flagBits = checksumPresent."""
    def crc32c(b):
        c = 0xFFFFFFFF
        for x in b:
            c ^= x
            for _ in range(8):
                c = (c >> 1) ^ 0x82F63B78 if c & 1 else c >> 1
        return c ^ 0xFFFFFFFF

    def send(good):
        body = bson.encode({"ping": 1, "$db": "admin"})
        rest = struct.pack("<I", 1) + b"\x00" + body           # flagBits = 1, kind 0, body
        length = 16 + len(rest) + 4
        msg = struct.pack("<iiii", length, 900 + good, 0, 2013) + rest
        crc = crc32c(msg) ^ (0 if good else 1)
        s = socket.create_connection((HOST, 27017))
        s.sendall(msg + struct.pack("<I", crc))
        try:
            hdr = s.recv(16)
        except ConnectionResetError:
            hdr = b""
        if len(hdr) < 16:
            print(f"checksum: {'good' if good else 'wrong'} CRC -> server closed the connection")
            return
        ln = struct.unpack("<i", hdr[:4])[0]
        data = hdr
        while len(data) < ln:
            data += s.recv(ln - len(data))
        flags = struct.unpack("<I", data[16:20])[0]
        reply = bson.decode(data[21:len(data) - (4 if flags & 1 else 0)])
        print(f"checksum: {'good' if good else 'wrong'} CRC -> reply {ln} B, flagBits={flags}, "
              f"ok={reply.get('ok')} {reply.get('codeName', '')}")
        s.close()

    send(True)
    send(False)


def _dt(secs):
    import datetime
    return datetime.datetime.fromtimestamp(secs, datetime.timezone.utc)


STEPS = {"batch": batch, "find": find, "w0": w0, "exhaust": exhaust, "checksum": checksum,
         "monitor": monitor}

if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    for name, fn in STEPS.items():
        if which in ("all", name):
            fn()
            time.sleep(0.5)
