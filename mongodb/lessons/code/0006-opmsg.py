#!/usr/bin/env python3
"""Decode MongoDB OP_MSG messages from a tcpdump capture (lesson 0006).

Usage (from the host, after capturing with tcpdump -i lo ... -w insert.pcap):
    python3 lessons/code/0006-opmsg.py insert.pcap            # insert commands + their replies
    python3 lessons/code/0006-opmsg.py insert.pcap --all      # every OP_MSG in the capture

Prints the 16-byte MsgHeader, flagBits, each section, and every BSON element with its byte
offset and raw bytes. Standard library only. Assumes an Ethernet/IPv4 capture (tcpdump -i lo
inside a Linux container gives exactly that) and does naive TCP reassembly (fine on loopback).
"""
import struct
import sys
from collections import defaultdict

FLAGS = {0: "checksumPresent", 1: "moreToCome", 16: "exhaustAllowed"}


def tcp_streams(path):
    data = open(path, "rb").read()
    streams, off = defaultdict(bytes), 24  # skip pcap global header
    while off + 16 <= len(data):
        _, _, incl, _ = struct.unpack("<IIII", data[off:off + 16])
        pkt, off = data[off + 16:off + 16 + incl], off + 16 + incl
        ip = pkt[14:]
        if not ip or ip[0] >> 4 != 4:
            continue
        tcp = ip[(ip[0] & 15) * 4:]
        sport, dport = struct.unpack(">HH", tcp[:4])
        payload = tcp[(tcp[12] >> 4) * 4:]
        if payload:
            streams[(sport, dport)] += payload
    return streams


def bson(b, o, end, depth, out):
    """Walk BSON elements in b[o:end] (end excludes the trailing 0x00)."""
    while o < end:
        t = b[o]
        n1 = b.index(0, o + 1)
        name, v = b[o + 1:n1].decode(), n1 + 1
        if t == 0x02:
            ln = struct.unpack("<i", b[v:v + 4])[0]; e = v + 4 + ln; val = repr(b[v + 4:e - 1].decode())
        elif t in (0x03, 0x04):
            ln = struct.unpack("<i", b[v:v + 4])[0]; e = v + ln; val = ("document" if t == 3 else "array") + f", {ln} B"
        elif t == 0x10:
            e = v + 4; val = struct.unpack("<i", b[v:e])[0]
        elif t == 0x12:
            e = v + 8; val = f"Long {struct.unpack('<q', b[v:e])[0]}"
        elif t == 0x01:
            e = v + 8; val = struct.unpack("<d", b[v:e])[0]
        elif t == 0x08:
            e = v + 1; val = bool(b[v])
        elif t == 0x07:
            e = v + 12; val = f"ObjectId('{b[v:e].hex()}')"
        elif t == 0x11:
            e = v + 8; inc, secs = struct.unpack("<II", b[v:e]); val = f"Timestamp({secs}, {inc})"
        elif t == 0x05:
            ln = struct.unpack("<i", b[v:v + 4])[0]; e = v + 5 + ln; val = f"Binary(subtype {b[v + 4]}, {ln} B)"
        elif t == 0x09:
            e = v + 8; val = f"Date({struct.unpack('<q', b[v:e])[0]})"
        elif t == 0x0A:
            e = v; val = "null"
        else:
            out.append(f"{o:5d}  {'  ' * depth}type 0x{t:02x} not decoded, stopping"); return
        raw = b[o:e].hex(" ")
        raw = raw if len(raw) <= 47 else raw[:47] + " …"
        out.append(f"{o:5d}  {'  ' * depth}0x{t:02x} {name}: {val}  ({e - o} B)  {raw}")
        if t in (0x03, 0x04):
            bson(b, v + 4, e - 1, depth + 1, out)
        o = e


def decode(msg):
    length, req, resp, opcode = struct.unpack("<iiii", msg[:16])
    out = [f"MsgHeader  messageLength={length}  requestID={req}  responseTo={resp}  opCode={opcode}",
           f"           {msg[:16].hex(' ')}"]
    if opcode != 2013:
        return out + [f"(opCode {opcode} is not OP_MSG)"]
    flags = struct.unpack("<I", msg[16:20])[0]
    names = [n for bit, n in FLAGS.items() if flags >> bit & 1] or ["none"]
    out.append(f"flagBits   {msg[16:20].hex(' ')}  ({', '.join(names)})")
    o, end = 20, length - (4 if flags & 1 else 0)
    while o < end:
        kind = msg[o]
        if kind == 0:
            ln = struct.unpack("<i", msg[o + 1:o + 5])[0]
            out.append(f"section    kind 0 (body), BSON document of {ln} B at offset {o + 1}")
            bson(msg, o + 5, o + ln, 1, out)
            o += 1 + ln
        else:
            ln = struct.unpack("<i", msg[o + 1:o + 5])[0]
            ident = msg[o + 5:msg.index(0, o + 5)].decode()
            out.append(f"section    kind 1 (document sequence '{ident}'), {ln} B")
            p = msg.index(0, o + 5) + 1
            while p < o + 1 + ln:
                dl = struct.unpack("<i", msg[p:p + 4])[0]
                out.append(f"           document of {dl} B at offset {p}")
                bson(msg, p + 4, p + dl - 1, 2, out)
                p += dl
            o += 1 + ln
    if flags & 1:
        out.append(f"checksum   {msg[-4:].hex(' ')}  (CRC-32C)")
    return out


def main():
    path, show_all = sys.argv[1], "--all" in sys.argv
    msgs = []
    for (sport, dport), s in tcp_streams(path).items():
        o = 0
        while o + 16 <= len(s):
            ln = struct.unpack("<i", s[o:o + 4])[0]
            if ln < 16 or o + ln > len(s):
                break
            msgs.append(((sport, dport), s[o:o + ln]))
            o += ln
    wanted = set()
    for _, m in msgs:
        if show_all or (len(m) > 30 and m[26:33] == b"insert\x00"):
            wanted.add(struct.unpack("<i", m[4:8])[0])
    for (sport, dport), m in msgs:
        req, resp = struct.unpack("<ii", m[4:12])
        if req in wanted or resp in wanted:
            print(f"\n=== {sport} -> {dport}, {len(m)} bytes")
            print("\n".join(decode(m)))


if __name__ == "__main__":
    main()
