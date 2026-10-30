#!/bin/sh
# Lesson 0009 lab: one line of ingress numbers for a running mongod container.
# Usage (from the host):  sh lessons/code/0009-measure.sh [container]   (default: lab9-mongod)
# Prints: OS threads and RSS of mongod (PID 1 in the official image), serverStatus().connections,
# the "passthrough" (dedicated-thread) executor's threadsRunning, and tcmalloc's allocated bytes.
C=${1:-lab9-mongod}
docker exec "$C" sh -c '
  T=$(awk "/^Threads:/ {print \$2}" /proc/1/status)
  R=$(awk "/^VmRSS:/ {printf \"%.0f\", \$2/1024}" /proc/1/status)
  mongosh --quiet --eval "
    const s = db.serverStatus({tcmalloc: 1}), c = s.connections;
    print(\"threads=$T rssMB=$R current=\" + c.current + \" available=\" + c.available +
          \" totalCreated=\" + c.totalCreated + \" rejected=\" + c.rejected + \" active=\" + c.active +
          \" passthroughThreads=\" + s.network.serviceExecutors.passthrough.threadsRunning +
          \" tcmallocMB=\" + (s.tcmalloc.generic.current_allocated_bytes / 1048576).toFixed(1) +
          \" heapMB=\" + (s.tcmalloc.generic.heap_size / 1048576).toFixed(1))"
'
