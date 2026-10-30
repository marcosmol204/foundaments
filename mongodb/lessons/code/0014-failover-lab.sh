#!/usr/bin/env bash
# Lesson 0014 lab: isolate the primary, write to it, watch the election and the rollback.
# Needs the 3-node set from lesson 13 (containers lab13-m1..3 on network lab13, m1 primary).
# Usage: bash lessons/code/0014-failover-lab.sh   (about 1 minute)
# The old primary is cut off with `docker network disconnect`; `docker exec` still reaches it.
# Writes use explicit {w: 1}: the implicit default is majority, which would block and then fail.
msh(){ docker exec "$1" mongosh --quiet --eval "$2" 2>&1; }
ts(){ date +%H:%M:%S; }
echo "$(ts) state:"; msh lab13-m1 'print(rs.status().members.map(m=>m.name.slice(0,9)+" "+m.stateStr).join(" | "), "term", rs.status().term)'
echo "$(ts) majority write before partition"; msh lab13-m1 'db.getSiblingDB("store").reviews.insertOne({_id:"before1",review:"before partition",rating:5,tags:[],verified:true},{writeConcern:{w:"majority"}}); print("ok")'
echo "$(ts) partition"; docker network disconnect lab13 lab13-m1; T0=$(date +%s)
echo "$(ts) writes on old primary"
msh lab13-m1 'const d=db.getSiblingDB("store"); const t=Date.now(); try{ d.reviews.insertOne({_id:"lost-A",review:"w1 on old primary",rating:1,tags:[],verified:false},{writeConcern:{w:1}}); print("w:1 acknowledged after", Date.now()-t, "ms") }catch(e){print("w:1 failed", e.message)}
const x=d.runCommand({insert:"reviews",documents:[{_id:"lost-B",review:"majority attempt",rating:1,tags:[],verified:false}],writeConcern:{w:"majority",wtimeout:2000}}); print("majority:", JSON.stringify({n:x.n, ok:x.ok, wce:x.writeConcernError&&x.writeConcernError.codeName, errmsg:x.errmsg}));
const s=rs.status(); print("m1 sees:", s.members.map(m=>m.name.slice(0,9)+" "+m.stateStr+(m.health?"":"(down)")).join(" | "))'
echo "$(ts) wait for election on the other side"
NP=""
for i in $(seq 1 30); do for n in 2 3; do if [ "$(docker exec lab13-m$n mongosh --quiet --eval 'print(db.hello().isWritablePrimary)' 2>/dev/null)" = "true" ]; then NP=lab13-m$n; fi; done; [ -n "$NP" ] && break; sleep 1; done
echo "$(ts) new primary $NP, $(( $(date +%s)-T0 )) s after partition"
msh $NP 'const d=db.getSiblingDB("store"); d.reviews.insertOne({_id:"kept-A",review:"on new primary",rating:4,tags:[],verified:true},{writeConcern:{w:"majority", wtimeout:5000}}); const s=rs.status(); print("term", s.term, "committed", s.optimes.lastCommittedOpTime.ts)'
echo "$(ts) m1 after 12 s"; sleep 3; msh lab13-m1 'try{print(db.hello().isWritablePrimary, db.getSiblingDB("store").reviews.find({_id:{$in:["lost-A","lost-B"]}}).toArray().map(d=>d._id).join())}catch(e){print(e.message)}'
echo "$(ts) heal"; docker network connect lab13 lab13-m1; sleep 20
msh lab13-m1 'const s=rs.status(); print(s.members.map(m=>m.name.slice(0,9)+" "+m.stateStr).join(" | "), "term", s.term); print("docs:", db.getSiblingDB("store").reviews.find({_id:{$in:["before1","lost-A","lost-B","kept-A"]}}).toArray().map(d=>d._id).join())'
docker exec lab13-m1 sh -c 'find /data/db/rollback -type f 2>/dev/null; ls /data/db/rollback 2>&1 | head -3'
docker logs lab13-m1 2>&1 | grep -i 'rollback' | grep -v 'Rollback ID\|rbid\|system.rollback' | sed -E 's/.*"\$date":"([^"]+)".*"msg":"([^"]+)".*/\1 \2/' | cut -c1-220 | tail -12
echo "== read concern on an isolated primary"
docker network disconnect lab13 lab13-m1
msh lab13-m1 'const d=db.getSiblingDB("store"); d.reviews.insertOne({_id:"lost-E",review:"w1 old primary",rating:1,tags:[],verified:false},{writeConcern:{w:1}});
const f=rc=>d.reviews.find({_id:"lost-E"}).readConcern(rc).toArray().length;
print("on the isolated old primary: local ->", f("local"), "| majority ->", f("majority"), "| isWritablePrimary", db.hello().isWritablePrimary)'
sleep 14
docker network connect lab13 lab13-m1; sleep 20
msh lab13-m1 'print("after heal: lost-E present?", db.getSiblingDB("store").reviews.countDocuments({_id:"lost-E"}), "| primary:", db.hello().primary)'
