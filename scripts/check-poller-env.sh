#!/bin/bash
PID=$(ps aux | grep 'poller.ts' | grep -v grep | grep 'setpoint-evals-dtm-examples' | grep node | tail -1 | awk '{print $2}')
echo "Poller PID: $PID"
if [ -n "$PID" ]; then
  cat /proc/$PID/environ 2>/dev/null | tr '\0' '\n' | grep -E 'SQS_ENDPOINT|MAX_MESSAGES|DEBUG_SERVER'
else
  echo "No poller found"
fi
