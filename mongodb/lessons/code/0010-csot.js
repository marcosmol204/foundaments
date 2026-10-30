// Lesson 0010 lab, optional step: client-side operation timeout (CSOT, `timeoutMS`) vs. maxTimeMS.
// Node.js driver 7.7.0 against the lab10-m1 container seeded with 5M reviews.
//
// Usage (from the mongodb/ folder, with lab10-m1 from the lesson running):
//   docker run -d --name lab10-node --network container:lab10-m1 -m 512m -v "$PWD/lessons/code":/code node:22-alpine sleep infinity
//   docker exec lab10-node sh -c 'cd /tmp && npm i -s mongodb@7.7.0'
//   docker exec -e NODE_PATH=/tmp/node_modules lab10-node node /code/0010-csot.js
//
// It iterates find({review: /battery/i}) three times with timeoutMS: 1000 and prints the wall-clock
// time until the driver gives up. Compare with lab step 4 (mongosh, maxTimeMS(1000)).
// Then read what the driver sent:  docker logs lab10-m1 2>&1 | grep '"Slow query"' | grep lab10-csot

const { MongoClient } = require('mongodb');

(async () => {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/?directConnection=true&appName=lab10-csot';
  const client = new MongoClient(uri, { timeoutMS: 1000 });
  const reviews = client.db('store').collection('reviews');
  await reviews.findOne({}); // connect first, so the driver has an RTT sample

  for (let i = 0; i < 3; i++) {
    const t = Date.now();
    let n = 0;
    try {
      for await (const _ of reviews.find({ review: /battery/i }, { comment: 'lab10-csot-' + i })) n++;
      console.log('finished:', n, 'documents');
    } catch (e) {
      console.log(`timeoutMS 1000 -> ${e.name} after ${n} documents, ${Date.now() - t} ms wall clock`);
    }
  }
  await client.close();
})();
