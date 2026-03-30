#!/bin/bash
# Kill only host pollers (not Docker container ones)
ps aux | grep "tsx.*poller" | grep -v grep | grep "$(whoami)" | awk '{print $2}' | xargs kill 2>/dev/null
sleep 2
echo "Host pollers killed"
ps aux | grep "tsx.*poller" | grep -v grep | grep "$(whoami)" | wc -l
