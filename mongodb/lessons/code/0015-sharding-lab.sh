#!/usr/bin/env bash
# Lesson 0015 lab: a 2-shard cluster in Docker; routing, shard-key choices and the balancer on store.reviews.
# Usage: bash lessons/code/0015-sharding-lab.sh setup     # cluster + 200,000 reviews (about 1 minute)
#        bash lessons/code/0015-sharding-lab.sh hashed    # shard on {_id:"hashed"}, 1 MB range size, watch the balancer
#        bash lessons/code/0015-sharding-lab.sh routing   # targeted vs scatter-gather explains
#        bash lessons/code/0015-sharding-lab.sh inserts   # 60,000 new reviews: hashed _id vs ranged _id
#        bash lessons/code/0015-sharding-lab.sh lowcard   # shard key {rating: 1}: jumbo chunks
#        bash lessons/code/0015-sharding-lab.sh teardown
# Run from the mongodb/ folder. Shards listen on 27018, the config server on 27019, mongos on 27017.
set -euo pipefail
LAB="$(cd "$(dirname "$0")" && pwd)"
SCR="${TMPDIR:-/tmp}/lab15"; mkdir -p "$SCR"
M() { docker exec mongos mongosh store --quiet --eval "$1"; }

case "${1:-}" in
setup)
  docker network create lab15 >/dev/null
  run() { docker run -d --name "$1" --network lab15 -m 1g mongo:8.0 "${@:2}" --bind_ip_all --wiredTigerCacheSizeGB 0.25 >/dev/null; }
  run cfg --configsvr --replSet cfgrs --port 27019; run sh1 --shardsvr --replSet s1rs --port 27018; run sh2 --shardsvr --replSet s2rs --port 27018
  docker run -d --name mongos --network lab15 -m 1g mongo:8.0 mongos --configdb cfgrs/cfg:27019 --bind_ip_all >/dev/null
  sleep 6
  docker exec cfg mongosh --port 27019 --quiet --eval 'rs.initiate({_id:"cfgrs",configsvr:true,members:[{_id:0,host:"cfg:27019"}]}).ok'
  docker exec sh1 mongosh --port 27018 --quiet --eval 'rs.initiate({_id:"s1rs",members:[{_id:0,host:"sh1:27018"}]}).ok'
  docker exec sh2 mongosh --port 27018 --quiet --eval 'rs.initiate({_id:"s2rs",members:[{_id:0,host:"sh2:27018"}]}).ok'
  sleep 12; docker restart mongos >/dev/null; sleep 6   # mongos started before the config server had a primary
  M 'sh.addShard("s1rs/sh1:27018"); sh.addShard("s2rs/sh2:27018")'
  docker cp "$LAB/seed-reviews.js" mongos:/seed-reviews.js
  docker exec mongos mongosh store --quiet --eval 'const N = 200000' --file /seed-reviews.js | tail -1 ;;
hashed)
  M 'sh.enableSharding("store"); db.reviews.createIndex({_id:"hashed"}); sh.shardCollection("store.reviews", {_id:"hashed"});
     db.adminCommand({configureCollectionBalancing:"store.reviews", chunkSize:1});
     const cfg=db.getSiblingDB("config"), u=cfg.collections.findOne({_id:"store.reviews"}).uuid;
     for (let i=0;i<6;i++){ sleep(5000); print((i+1)*5+"s chunks:", cfg.chunks.aggregate([{$match:{uuid:u}},{$group:{_id:"$shard",n:{$sum:1}}}]).toArray().map(x=>x._id+":"+x.n).join(" ")) }
     print("docs via mongos:", db.reviews.countDocuments({}), "| per shard incl. orphans:", db.reviews.aggregate([{$collStats:{storageStats:{}}}]).toArray().map(x=>x.shard+"="+x.storageStats.count).join(" "))' ;;
routing)
  M 'const r=db.reviews; const id=r.findOne({rating:4})._id;
     const show=(n,e)=>{const w=e.queryPlanner.winningPlan; print(n.padEnd(32), w.stage, (w.shards||[]).map(s=>s.shardName).join(","), "docsExamined", e.executionStats.totalDocsExamined)};
     show("find({_id})", r.find({_id:id}).explain("executionStats"));
     show("find({_id: {$gte: X}})", r.find({_id:{$gte:ObjectId.createFromTime(1767225600+190000)}}).explain("executionStats"));
     show("find({rating:5, verified:true})", r.find({rating:5, verified:true}).explain("executionStats"))' ;;
inserts)
  ins() { docker exec "$1" mongosh --port 27018 --quiet --eval 'print(Number(db.serverStatus().opcounters.insert))'; }
  load='const r=db.getSiblingDB("store").reviews; const base=1767225600+300000; const tags=["battery","price","quality"]; let k=0;
    for(let b=0;b<60;b++){ const docs=[]; for(let i=0;i<1000;i++,k++) docs.push({_id:ObjectId.createFromTime(base+k), review:"new review "+k, rating:1+(k%5), tags:[tags[k%3]], verified:k%3>0}); r.insertMany(docs,{ordered:false}); }'
  for key in '{_id:"hashed"}' '{_id:1}'; do
    M 'db.reviews.drop(); db.adminCommand({shardCollection:"store.reviews", key:'"$key"'})'
    a1=$(ins sh1); a2=$(ins sh2); M "$load"; b1=$(ins sh1); b2=$(ins sh2)
    echo "key $key -> inserts handled: s1rs +$((b1-a1))  s2rs +$((b2-a2))"
  done ;;
lowcard)
  M 'const r=db.reviews, cfg=db.getSiblingDB("config"); r.drop(); r.createIndex({rating:1});
     db.adminCommand({shardCollection:"store.reviews", key:{rating:1}}); db.adminCommand({configureCollectionBalancing:"store.reviews", chunkSize:1});
     const base=1767225600+600000, w=[5,5,5,5,5,4,4,4,3,2]; let k=0;
     for(let b=0;b<120;b++){ const docs=[]; for(let i=0;i<1000;i++,k++) docs.push({_id:ObjectId.createFromTime(base+k), review:"x".repeat(150)+k, rating:w[k%10], tags:["price"], verified:true}); r.insertMany(docs,{ordered:false}); }
     sleep(25000); const u=cfg.collections.findOne({_id:"store.reviews"}).uuid;
     cfg.chunks.find({uuid:u}).sort({min:1}).forEach(c=>print("chunk", JSON.stringify(c.min), "->", JSON.stringify(c.max), c.shard, c.jumbo?"JUMBO":""))' ;;
teardown)
  docker rm -f cfg sh1 sh2 mongos >/dev/null; docker network rm lab15 >/dev/null ;;
*) sed -n 2,10p "$0"; exit 1 ;;
esac
