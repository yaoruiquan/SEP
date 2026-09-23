# E2E Testing Guide

## Quick Start

```bash
# Terminal 1: Start backend in E2E mode
cd ../backend
E2E_TEST=1 pnpm dev

# Terminal 2: Run E2E tests
cd web
pnpm test:e2e
```

## Why E2E_TEST=1 is Required

The backend has rate limiting enabled by default to protect against abuse:
- Auth endpoints: 10 requests per minute
- Other endpoints: 100 requests per minute

E2E tests make multiple rapid requests that would hit these limits. Setting `E2E_TEST=1` increases the limits for testing:
- Auth endpoints: 1000 requests per minute  
- Other endpoints: 10000 requests per minute

**Without this flag, E2E tests will fail with rate limiting errors.**

## Available Commands

```bash
# Run all E2E tests
pnpm test:e2e

# Run with Playwright UI (interactive mode)
pnpm test:e2e:ui

# Run in headed mode (see browser)
pnpm test:e2e:headed

# Debug mode (step through tests)
pnpm test:e2e:debug

# View last test report
pnpm test:e2e:report

# Run specific test file
pnpm test:e2e e2e/client-sdk.spec.ts

# Use helper script (includes backend check)
./scripts/run-e2e-tests.sh
```

## Test Coverage

### Client SDK Flow (6 tests)
Tests the full client SDK authentication and model gateway flow:
1. Client login with device fingerprint
2. Subscription list retrieval  
3. Employment token exchange
4. Model gateway chat completion
5. Streaming response handling
6. Billing record verification

### Enterprise Flow (5 tests)
Tests enterprise user journey from registration to chat:
1. Enterprise registration
2. Enterprise login
3. Employee marketplace browsing
4. Digital employee subscription
5. Chat session initiation

### Platform Admin Flow (5 tests)
Tests platform admin management interface:
1. Platform admin login
2. Capability management view
3. Employee management view
4. Enterprise management view
5. Platform statistics dashboard

## Test Architecture

### Auth State Persistence
Platform flow tests use Playwright's `storageState` feature to avoid repeated logins:
- Test 1 logs in and saves cookies to `/tmp/e2e-admin-auth-state.json`
- Tests 2-5 load the saved state instead of logging in again
- This prevents hitting rate limits and speeds up test execution

### Sequential Execution
Tests use `test.describe.serial()` to ensure proper execution order:
- Client SDK tests must run in order (each depends on previous test's data)
- Platform flow tests share auth state (test 1 must run before others)

## Troubleshooting

### "Backend not running" error
```bash
# Check if backend is running
curl http://localhost:3001/api/health

# If not, start it with E2E flag
cd ../backend
E2E_TEST=1 pnpm dev
```

### "Too Many Requests" / Rate limiting errors
```bash
# Make sure backend was started with E2E_TEST=1
# Kill existing backend and restart:
pkill -f "pnpm.*dev"
cd ../backend
E2E_TEST=1 pnpm dev
```

### Tests timeout or hang
```bash
# Check for multiple backend instances
ps aux | grep "pnpm.*dev"

# Kill all instances and start fresh
pkill -f "pnpm.*dev"
cd ../backend  
E2E_TEST=1 pnpm dev
```

### Database state issues
```bash
# Reset database and reseed
cd ../backend
pnpm db:migrate
pnpm db:seed
```

## CI/CD Integration

For CI environments, set up the E2E test environment:

```yaml
# Example GitHub Actions workflow
- name: Start backend in E2E mode
  run: |
    cd backend
    E2E_TEST=1 pnpm dev &
    sleep 5
    
- name: Run E2E tests
  run: |
    cd web
    pnpm test:e2e
```

## Test Stability

All 16 tests pass consistently when run with proper setup:
- Average execution time: 13-15 seconds
- No flakiness when backend is in E2E mode
- Verified across multiple consecutive runs

See `docs/testing/e2e-test-status.md` for detailed test status and fixes applied.
