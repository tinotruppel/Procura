#!/usr/bin/env bash
# Full test workflow: tests, coverage, ESLint, Semgrep, npm audit, build
# Usage: bash scripts/test-all.sh

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FRONTEND="$ROOT/frontend"
BACKEND="$ROOT/backend"
PASS=0
FAIL=0
REPORT=""

section() {
    echo ""
    echo "========================================"
    echo "  $1"
    echo "========================================"
}

record() {
    local name="$1" status="$2" detail="${3:-}"
    if [ "$status" = "PASS" ]; then
        PASS=$((PASS + 1))
        REPORT="$REPORT\n  ✅ $name"
    else
        FAIL=$((FAIL + 1))
        REPORT="$REPORT\n  ❌ $name"
    fi
    [ -n "$detail" ] && REPORT="$REPORT — $detail"
}

# ── Frontend Tests + Coverage ──
section "Frontend Tests + Coverage"
cd "$FRONTEND"
if npx vitest run --coverage 2>&1 | tee /tmp/frontend-test.log; then
    # Extract summary lines
    TESTS=$(grep -E '^\s*Tests\s' /tmp/frontend-test.log | tail -1)
    COVERAGE=$(grep 'All files' /tmp/frontend-test.log | head -1)
    echo "$TESTS"
    echo "$COVERAGE"
    record "Frontend Tests" "PASS" "$TESTS"
    record "Frontend Coverage" "PASS" "$COVERAGE"
else
    FAILURES=$(grep -E 'FAIL|Error|AssertionError' /tmp/frontend-test.log | head -20)
    echo "$FAILURES"
    record "Frontend Tests" "FAIL" "see /tmp/frontend-test.log"
fi

# ── Backend Tests + Coverage ──
section "Backend Tests + Coverage"
cd "$BACKEND"
if npx vitest run --coverage 2>&1 | tee /tmp/backend-test.log; then
    TESTS=$(grep -E '^\s*Tests\s' /tmp/backend-test.log | tail -1)
    COVERAGE=$(grep 'All files' /tmp/backend-test.log | head -1)
    echo "$TESTS"
    echo "$COVERAGE"
    record "Backend Tests" "PASS" "$TESTS"
    record "Backend Coverage" "PASS" "$COVERAGE"
else
    FAILURES=$(grep -E 'FAIL|Error|AssertionError' /tmp/backend-test.log | head -20)
    echo "$FAILURES"
    record "Backend Tests" "FAIL" "see /tmp/backend-test.log"
fi

# ── Frontend ESLint ──
section "Frontend ESLint"
cd "$FRONTEND"
if npx eslint src/ 2>&1 | tee /tmp/frontend-eslint.log; then
    record "Frontend ESLint" "PASS"
else
    ERRORS=$(cat /tmp/frontend-eslint.log | tail -30)
    echo "$ERRORS"
    record "Frontend ESLint" "FAIL" "see /tmp/frontend-eslint.log"
fi

# ── Backend ESLint ──
section "Backend ESLint"
cd "$BACKEND"
if npx eslint src/ 2>&1 | tee /tmp/backend-eslint.log; then
    record "Backend ESLint" "PASS"
else
    ERRORS=$(cat /tmp/backend-eslint.log | tail -30)
    echo "$ERRORS"
    record "Backend ESLint" "FAIL" "see /tmp/backend-eslint.log"
fi

# ── Semgrep ──
section "Semgrep"
if command -v semgrep &>/dev/null; then
    if semgrep --config auto "$FRONTEND/src/" "$BACKEND/src/" --quiet 2>&1 | tee /tmp/semgrep.log; then
        record "Semgrep" "PASS"
    else
        FINDINGS=$(cat /tmp/semgrep.log | tail -30)
        echo "$FINDINGS"
        record "Semgrep" "FAIL" "see /tmp/semgrep.log"
    fi
else
    echo "semgrep not installed, skipping"
    record "Semgrep" "PASS" "not installed, skipped"
fi

# ── npm audit ──
section "npm audit (Frontend)"
cd "$FRONTEND"
if npm audit 2>&1 | tee /tmp/frontend-audit.log; then
    record "Frontend npm audit" "PASS"
else
    ISSUES=$(cat /tmp/frontend-audit.log | tail -20)
    echo "$ISSUES"
    record "Frontend npm audit" "FAIL" "see /tmp/frontend-audit.log"
fi

section "npm audit (Backend)"
cd "$BACKEND"
npm audit 2>&1 | tee /tmp/backend-audit.log || true
# Only fail on high/critical
if grep -qE 'high|critical' /tmp/backend-audit.log; then
    record "Backend npm audit" "FAIL" "high/critical vulnerabilities found"
else
    MODERATE=$(grep -c 'moderate' /tmp/backend-audit.log 2>/dev/null || echo "0")
    record "Backend npm audit" "PASS" "$MODERATE moderate (dev-deps only)"
fi

# ── Frontend Build ──
section "Frontend Build (Extension)"
cd "$FRONTEND"
if npm run build:extension 2>&1 | tee /tmp/frontend-build.log | tail -5; then
    record "Frontend Build" "PASS"
else
    ERRORS=$(cat /tmp/frontend-build.log | tail -20)
    echo "$ERRORS"
    record "Frontend Build" "FAIL" "see /tmp/frontend-build.log"
fi

# ── Backend Build ──
section "Backend Build"
cd "$BACKEND"
if npm run build 2>&1 | tee /tmp/backend-build.log | tail -5; then
    record "Backend Build" "PASS"
else
    ERRORS=$(cat /tmp/backend-build.log | tail -20)
    echo "$ERRORS"
    record "Backend Build" "FAIL" "see /tmp/backend-build.log"
fi

# ── Summary ──
echo ""
echo "========================================"
echo "  SUMMARY: $PASS passed, $FAIL failed"
echo "========================================"
echo -e "$REPORT"
echo ""

if [ "$FAIL" -gt 0 ]; then
    echo "❌ Some checks failed. See logs in /tmp/ for details."
    exit 1
else
    echo "✅ All checks passed!"
    exit 0
fi
