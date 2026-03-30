#!/bin/bash
# Run STE suite with queue purges between tests to avoid cross-contamination
set -o pipefail

WORKFLOW="${1:?Usage: run-ste-suite.sh <workflow-name>}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STE_DIR="$SCRIPT_DIR/workflows/$WORKFLOW/ste"

if [ ! -d "$STE_DIR" ]; then
  echo "ERROR: STE directory not found: $STE_DIR"
  exit 1
fi

echo "=========================================="
echo "  $WORKFLOW: Running All STEs (with purge)"
echo "=========================================="

PASSED=0
FAILED=0
TOTAL=0
FAILED_TESTS=""

purge_queues() {
  docker exec dtm-localstack awslocal sqs list-queues --region us-east-1 --output text 2>/dev/null | tr '\t' '\n' | grep -v "QUEUEURLS" | grep -v "^$" | while read url; do
    docker exec dtm-localstack awslocal sqs purge-queue --queue-url "$url" --region us-east-1 2>/dev/null
  done
}

for test_dir in "$STE_DIR"/*/; do
  test_script="$test_dir/test.sh"
  if [[ -f "$test_script" ]]; then
    TOTAL=$((TOTAL + 1))
    test_name=$(basename "$test_dir")

    echo ""
    echo "=== Purging queues before $test_name ==="
    purge_queues
    sleep 2

    echo ""
    echo "--- Running: $test_name ---"
    if bash "$test_script"; then
      PASSED=$((PASSED + 1))
    else
      FAILED=$((FAILED + 1))
      FAILED_TESTS="$FAILED_TESTS $test_name"
      echo "FAILED: $test_name"
    fi
  fi
done

echo ""
echo "=========================================="
echo "  Results: $PASSED passed, $FAILED failed (of $TOTAL)"
if [ -n "$FAILED_TESTS" ]; then
  echo "  Failed:$FAILED_TESTS"
fi
echo "=========================================="
[[ $FAILED -eq 0 ]] && exit 0 || exit 1
