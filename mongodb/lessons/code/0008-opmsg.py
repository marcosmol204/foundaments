#!/usr/bin/env python3
"""Decode MongoDB wire traffic from a tcpdump capture (lesson 0008).

Builds on lessons/code/0006-opmsg.py. New here: every flagBit (checksumPresent, moreToCome,
exhaustAllowed) with a CRC-32C check, kind-1 document sequences (count and sizes), and
OP_COMPRESSED (opcode 2012): its header, plus the decompressed message inside it.

Usage (from the mongodb/ folder, after a capture like lesson 0008's lab):
    python3 lessons/code/0008-opmsg.py wire.pcap                 # one line per message + totals
    python3 lessons/code/0008-opmsg.py wire.pcap --cmd insert    # only insert commands and their replies
    python3 lessons/code/0008-opmsg.py wire.pcap --cmd find --detail   # also dump the BSON of the body

Standard library only. zlib always decompresses; zstd needs Python 3.14+ (compression.zstd);
snappy uses the small decoder below. Works with Ethernet, Linux cooked (tcpdump -i any) and
loopback captures, IPv4 and IPv6. TCP is reassembled by sequence number, so duplicated or
retransmitted segments are dropped.

One output line per message:
    0.412s c>s len=164256 id=…  re=0  OP_MSG flags=[none] insert body 86 B · seq 'documents' 164148 B, 1000 docs (125–212 B)
Time is seconds since the first message. c>s is client → server, s>c is server → client.
id is the requestID, re is responseTo. For OP_COMPRESSED the line shows the wire size
first, then "→ N B inside" and the message it contained.
"""
import struct
import sys
import zlib
from collections import defaultdict

FLAGS = {0: "checksumPresent", 1: "moreToCome", 16: "exhaustAllowed"}
OPCODES = {2013: "OP_MSG", 2012: "OP_COMPRESSED", 1: "OP_REPLY", 2004: "OP_QUERY"}
COMPRESSORS = {0: "noop", 1: "snappy", 2: "zlib", 3: "zstd"}
SERVER_PORT = 27017


# ---------------------------------------------------------------- capture → TCP byte streams
def packets(path):
    data = open(path, "rb").read()
    magic, = struct.unpack("<I", data[:4])
    if magic not in (0xA1B2C3D4, 0xA1B23C4D):
        sys.exit("not a classic pcap file (pcapng is not supported: use tcpdump -w)")
    linktype = struct.unpack("<I", data[20:24])[0]
    skip = {1: 14, 113: 16, 276: 20, 0: 4, 101: 0, 12: 0}.get(linktype)
    if skip is None:
        sys.exit(f"unsupported link type {linktype}")
    off = 24
    while off + 16 <= len(data):
        sec, usec, incl = struct.unpack("<III", data[off:off + 12])
        yield sec + usec / 1e6, data[off + 16 + skip:off + 16 + incl]
        off += 16 + incl


def tcp_streams(path):
    """{(sport, dport): (bytes, [(stream offset, capture time)])}, reassembled by TCP seq."""
    segs = defaultdict(dict)
    for ts, ip in packets(path):
        if not ip:
            continue
        if ip[0] >> 4 == 4:
            if ip[9] != 6:
                continue
            tcp = ip[(ip[0] & 15) * 4:struct.unpack(">H", ip[2:4])[0]]
        elif ip[0] >> 4 == 6:
            if ip[6] != 6:
                continue
            tcp = ip[40:40 + struct.unpack(">H", ip[4:6])[0]]
        else:
            continue
        sport, dport, seq = struct.unpack(">HHI", tcp[:8])
        payload = tcp[(tcp[12] >> 4) * 4:]
        if payload:
            segs[(sport, dport)].setdefault(seq, (ts, payload))
    streams = {}
    for key, by_seq in segs.items():
        out, nxt, times = bytearray(), None, []
        for seq in sorted(by_seq):          # (ignores 32-bit wrap: fine for a short lab capture)
            ts, p = by_seq[seq]
            full = len(p)
            if nxt is not None and seq < nxt:
                p = p[nxt - seq:]           # overlap with what we already have
            if p:
                times.append((len(out), ts))
            out += p
            nxt = seq + full if nxt is None else max(nxt, seq + full)
        streams[key] = (bytes(out), times)
    return streams


# ---------------------------------------------------------------- decompressors, CRC-32C
def snappy_decompress(src):
    """Raw snappy format (what MongoDB uses): varint length, then literal/copy elements."""
    n, shift, i = 0, 0, 0
    while True:
        b = src[i]; i += 1
        n |= (b & 0x7F) << shift; shift += 7
        if b < 0x80:
            break
    out = bytearray()
    while i < len(src):
        tag = src[i]; i += 1
        kind = tag & 3
        if kind == 0:                                   # literal
            ln = tag >> 2
            if ln >= 60:
                nb = ln - 59
                ln = int.from_bytes(src[i:i + nb], "little"); i += nb
            ln += 1
            out += src[i:i + ln]; i += ln
            continue
        if kind == 1:
            ln = ((tag >> 2) & 7) + 4; off = ((tag >> 5) << 8) | src[i]; i += 1
        elif kind == 2:
            ln = (tag >> 2) + 1; off = int.from_bytes(src[i:i + 2], "little"); i += 2
        else:
            ln = (tag >> 2) + 1; off = int.from_bytes(src[i:i + 4], "little"); i += 4
        for _ in range(ln):                             # byte by byte: copies may overlap
            out.append(out[-off])
    assert len(out) == n, "snappy: wrong length"
    return bytes(out)


def decompress(cid, payload):
    if cid == 0:
        return payload
    if cid == 1:
        return snappy_decompress(payload)
    if cid == 2:
        return zlib.decompress(payload)
    if cid == 3:
        try:
            from compression import zstd           # Python 3.14+
        except ImportError:
            return None
        return zstd.decompress(payload)
    return None


_CRC_TABLE = []
for _n in range(256):
    _c = _n
    for _ in range(8):
        _c = (_c >> 1) ^ 0x82F63B78 if _c & 1 else _c >> 1
    _CRC_TABLE.append(_c)


def crc32c(b):
    c = 0xFFFFFFFF
    for x in b:
        c = _CRC_TABLE[(c ^ x) & 0xFF] ^ (c >> 8)
    return c ^ 0xFFFFFFFF


# ---------------------------------------------------------------- BSON (same walker as 0006)
def bson(b, o, end, depth, out):
    while o < end:
        t = b[o]
        n1 = b.index(0, o + 1)
        name, v = b[o + 1:n1].decode(errors="replace"), n1 + 1
        if t == 0x02:
            ln = struct.unpack("<i", b[v:v + 4])[0]; e = v + 4 + ln; val = repr(b[v + 4:e - 1].decode(errors="replace"))
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
            out.append(f"{o:7d}  {'  ' * depth}type 0x{t:02x} not decoded, stopping"); return
        out.append(f"{o:7d}  {'  ' * depth}{name}: {val}  ({e - o} B)")
        if t == 0x03 or (t == 0x04 and (depth < 2 or ln < 256)):
            bson(b, v + 4, e - 1, depth + 1, out)
        o = e


def first_key(b, o):
    """Name of the first element of the BSON document starting at b[o]."""
    if b[o + 4] == 0:
        return "{}"
    return b[o + 5:b.index(0, o + 5)].decode(errors="replace")


# ---------------------------------------------------------------- one message
def describe(msg, detail):
    """Returns (summary string, command name or None, detail lines)."""
    length, _, _, opcode = struct.unpack("<iiii", msg[:16])
    lines = []
    if opcode == 2012:
        orig, usize, cid = struct.unpack("<iiB", msg[16:25])
        inner = decompress(cid, msg[25:])
        head = (f"OP_COMPRESSED({COMPRESSORS.get(cid, cid)}) originalOpcode={orig} "
                f"uncompressedSize={usize}")
        if inner is None:
            return head + "  (cannot decompress here)", None, lines
        full = msg[:12] + struct.pack("<i", orig) + inner   # rebuild the original message
        full = struct.pack("<i", 16 + len(inner)) + full[4:]
        s, cmd, lines = describe(full, detail)
        return f"{head} → {16 + usize} B inside: {s}", cmd, lines
    if opcode != 2013:
        return OPCODES.get(opcode, f"opCode {opcode}"), None, lines
    flags = struct.unpack("<I", msg[16:20])[0]
    names = [n for bit, n in FLAGS.items() if flags >> bit & 1]
    unknown = flags & ~0x10003
    if unknown:
        names.append(f"unknown 0x{unknown:x}")
    end = length - (4 if flags & 1 else 0)
    parts, cmd, o = [], None, 20
    while o < end:
        kind = msg[o]
        if kind == 0:
            ln = struct.unpack("<i", msg[o + 1:o + 5])[0]
            cmd = first_key(msg, o + 1)
            parts.append(f"body {ln} B")
            if detail:
                lines.append(f"  kind 0 body, {ln} B at offset {o + 1}")
                bson(msg, o + 5, o + ln, 2, lines)
            o += 1 + ln
        elif kind == 1:
            ln = struct.unpack("<i", msg[o + 1:o + 5])[0]
            z = msg.index(0, o + 5)
            ident = msg[o + 5:z].decode()
            p, sizes = z + 1, []
            while p < o + 1 + ln:
                sizes.append(struct.unpack("<i", msg[p:p + 4])[0]); p += sizes[-1]
            rng = f"{min(sizes)}–{max(sizes)} B" if sizes else "empty"
            parts.append(f"seq '{ident}' {ln} B, {len(sizes)} docs ({rng})")
            if detail:
                lines.append(f"  kind 1 sequence '{ident}', {ln} B at offset {o + 1}: "
                             f"size int32 + '{ident}\\0' + {len(sizes)} BSON documents back to back")
            o += 1 + ln
        elif kind == 2:
            z = msg.index(0, o + 1)
            parts.append(f"securityToken {z - o} B"); o = z + 1
        else:
            parts.append(f"unknown section kind {kind}, stopping"); break
    if flags & 1:
        want, got = struct.unpack("<I", msg[-4:])[0], crc32c(msg[:-4])
        parts.append(f"CRC-32C {'ok' if want == got else 'MISMATCH'}")
    flagtxt = ",".join(names) if names else "none"
    return f"OP_MSG flags=[{flagtxt}] {cmd} " + " · ".join(parts), cmd, lines


# ---------------------------------------------------------------- main
def main():
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    path, detail = args[0], "--detail" in args
    only = args[args.index("--cmd") + 1] if "--cmd" in args else None

    msgs = []                                   # (time, direction, stream key, message bytes)
    for (sport, dport), (s, times) in tcp_streams(path).items():
        direction = "c>s" if dport == SERVER_PORT else "s>c"
        o, t = 0, 0
        while o + 16 <= len(s):
            ln = struct.unpack("<i", s[o:o + 4])[0]
            if ln < 16 or o + ln > len(s):
                break
            while t + 1 < len(times) and times[t + 1][0] <= o:
                t += 1
            msgs.append((times[t][1], direction, (sport, dport), s[o:o + ln]))
            o += ln
    msgs.sort(key=lambda x: x[0])

    # Keep the chosen commands, their replies, and exhaust follow-ups (responseTo = previous reply).
    shown, wanted = [], set()
    t0 = msgs[0][0] if msgs else 0
    for ts, d, key, m in msgs:
        s, cmd, lines = describe(m, detail)
        req, resp = struct.unpack("<ii", m[4:12])
        keep = only is None or (d == "c>s" and cmd == only) or (d == "s>c" and resp in wanted)
        if keep and only is not None:
            wanted.add(req)
        if keep:
            shown.append((ts - t0, d, key, m, s, lines))

    totals = defaultdict(lambda: [0, 0])
    for t, d, key, m, s, lines in shown:
        _, req, resp, _ = struct.unpack("<iiii", m[:16])
        print(f"{t:7.3f}s {d} len={len(m):<8} id={req:<10} re={resp:<10} {s}")
        for line in lines:
            print(line)
        totals[d][0] += 1
        totals[d][1] += len(m)
    print()
    for d in ("c>s", "s>c"):
        n, b = totals[d]
        print(f"{d}: {n} messages, {b:,} bytes on the wire")


if __name__ == "__main__":
    main()
