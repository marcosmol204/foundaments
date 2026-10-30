// Lesson 0013 lab: read your writes in local.oplog.rs, oplog size and window, replication optimes.
// Usage (3-node replica set with 100,000 reviews, see the lesson): docker cp lessons/code/0013-oplog-lab.js lab13-m1:/o.js && docker exec lab13-m1 mongosh --quiet --file /o.js
const r = db.getSiblingDB("store").reviews; const ol = db.getSiblingDB("local").oplog.rs;
const id = r.findOne({rating:3})._id;
const t0 = ol.find().sort({$natural:-1}).limit(1).next().ts;
r.updateOne({_id:id}, {$inc:{rating:1}});
r.updateOne({_id:id}, {$push:{tags:"battery"}});
r.updateOne({_id:id}, {$set:{verified:true}});
r.insertOne({review:"oplog demo", rating:5, tags:["quality"], verified:true});
r.deleteOne({review:"oplog demo"});
r.updateMany({_id:{$gte:ObjectId.createFromTime(1767225600+99990)}}, {$set:{verified:false}});
ol.find({ts:{$gt:t0}, ns:"store.reviews"}).forEach(e=>print(JSON.stringify(e).slice(0,330)));
print("--- oplog stats");
const s = ol.stats(); print("maxSize MB", Math.round(s.maxSize/2**20), "size MB", Math.round(s.size/2**20), "count", s.count);
const first = ol.find().sort({$natural:1}).limit(1).next(), last = ol.find().sort({$natural:-1}).limit(1).next();
print("window secs", last.wall ? (last.wall-first.wall)/1000 : "n/a", "first op", first.op, first.ns);
print("collection info:", JSON.stringify(db.getSiblingDB("local").getCollectionInfos({name:"oplog.rs"})[0].options));
printjson(db.adminCommand({replSetGetStatus:1}).optimes);
