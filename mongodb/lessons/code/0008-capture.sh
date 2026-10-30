#!/bin/sh
# Lesson 0008: capture one lab step's wire traffic into <step>.pcap, then decode it.
#
# Usage (from the mongodb/ folder, with lab8-m1 running on network lab8-net, see the lesson):
#   sh lessons/code/0008-capture.sh batch      # pymongo insert_many: kind-1 sequences, batch split
#   sh lessons/code/0008-capture.sh find       # one day of reviews: none / snappy / zstd / zlib
#   sh lessons/code/0008-capture.sh w0         # w:0 inserts: moreToCome, no reply
#   sh lessons/code/0008-capture.sh exhaust    # exhaust cursor: one getMore, many replies
#   sh lessons/code/0008-capture.sh checksum   # hand-built OP_MSG with a CRC-32C, good and bad
#   sh lessons/code/0008-capture.sh monitor    # idle client: streaming hello every 10 s
#   sh lessons/code/0008-capture.sh mongosh    # mongosh insertMany of the same 1,000 reviews
# Then: python3 lessons/code/0008-opmsg.py <step>.pcap [--cmd insert] [--detail]
#
# The first run creates lab8-py (python:3.12-slim + pymongo, zstd and snappy support).
# tcpdump runs in lab8-dump, which shares lab8-m1's network, and writes inside the container
# (writing a big capture straight to a macOS bind mount drops packets).
set -e
STEP=${1:?usage: 0008-capture.sh <step>}
CODE="$(cd "$(dirname "$0")" && pwd)"

if ! docker inspect lab8-py >/dev/null 2>&1; then
  docker run -d --name lab8-py --network lab8-net -m 1g -v "$CODE":/code python:3.12-slim sleep infinity >/dev/null
  docker exec lab8-py pip install -q --root-user-action=ignore pymongo zstandard backports.zstd python-snappy
fi

docker rm -f lab8-dump >/dev/null 2>&1 || true
docker run -d --name lab8-dump --net container:lab8-m1 alpine:3.20 \
  sh -c "apk add -q tcpdump && tcpdump -i any -B 262144 -s 0 -U -w /tmp/cap.pcap 'tcp port 27017'" >/dev/null
sleep 6   # apk add + tcpdump start

if [ "$STEP" = mongosh ]; then
  docker exec lab8-m1 mongosh store --quiet --eval '
    const docs = db.reviews.find({}, { _id: 0 }).limit(1000).toArray()
    db.scratch.drop(); print("mongosh: inserted", Object.keys(db.scratch.insertMany(docs).insertedIds).length); db.scratch.drop()'
else
  docker exec lab8-py python /code/0008-wire-lab.py "$STEP"
fi

sleep 2
docker exec lab8-dump pkill tcpdump; sleep 1
docker cp -q lab8-dump:/tmp/cap.pcap "./$STEP.pcap"
docker logs lab8-dump 2>&1 | grep 'dropped by kernel'
docker rm -f lab8-dump >/dev/null
echo "wrote ./$STEP.pcap"
