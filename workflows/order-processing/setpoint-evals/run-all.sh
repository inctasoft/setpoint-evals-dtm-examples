#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "=========================================="
echo "  order-processing: Running All SEs"
echo "=========================================="
PASSED=0
FAILED=0
TOTAL=0
for test_dir in "$SCRIPT_DIR"/*/; do
  test_script="$test_dir/test.sh"
  if [[ -f "$test_script" ]]; then
    TOTAL=$((TOTAL + 1))
    test_name=$(basename "$test_dir")
    echo ""
    echo "--- Running: $test_name ---"
    if bash "$test_script"; then
      PASSED=$((PASSED + 1))
    else
      FAILED=$((FAILED + 1))
      echo "FAILED: $test_name"
    fi
  fi
done
echo ""
echo "=========================================="
echo "  Results: $PASSED passed, $FAILED failed (of $TOTAL)"
echo "=========================================="
[[ $FAILED -eq 0 ]] && exit 0 || exit 1
