#!/bin/bash
set -e

echo "🚀 Starting E2E Test Suite"
echo "============================"

# Check if backend is running
if ! curl -s http://localhost:3001/api/health > /dev/null 2>&1; then
  echo "❌ Backend is not running on port 3001"
  echo ""
  echo "To run E2E tests, start the backend with E2E_TEST=1:"
  echo "  cd ../backend && E2E_TEST=1 pnpm dev"
  echo ""
  exit 1
fi

# Check if E2E mode is enabled (test by making multiple requests)
echo "✓ Backend is running"
echo ""

# Run Playwright tests
echo "Running Playwright E2E tests..."
echo ""
SKIP_WEB_SERVER=1 pnpm playwright test "$@"
