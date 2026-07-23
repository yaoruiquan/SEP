# Layer 1 Technical Validation Report

## Status: 🔄 Planned (blocked on external service credentials)

Created: 2026-07-23 · Updated: 2026-07-23

> **Terminology note**: Earlier design docs say "ModelRelayClient" / "new-api". The
> concrete implementation is **sub2api** — a self-hosted token relay station exposing an
> OpenAI-compatible endpoint. OpenCode is **not** spawned as a CLI; it runs as a separate
> **HTTP service** (see `yaoruiquan/opencode-skiills-service`). This doc uses the real names.

---

## Overview

Layer 1 validates the core technical risks before feature development:

1. **Vercel AI SDK + sub2api integration** (model calls via the relay)
2. **OpenCode Skills Service integration** (HTTP job API)
3. **Streaming & tool-calling validation**

Both dependencies are **external services** — not in this repo, not in docker-compose.
They are reached via `.env`:
- `SUB2API_BASE_URL` / `SUB2API_API_KEY`
- `OPENCODE_API_BASE_URL` / `OPENCODE_API_TOKEN`

---

## 1. Vercel AI SDK + sub2api Integration

### Objective

Verify Vercel AI SDK can call models through sub2api's OpenAI-compatible endpoint.

### Test Setup

```typescript
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { streamText, tool } from 'ai';
import { z } from 'zod';

const sub2api = createOpenAICompatible({
  name: 'sub2api',
  baseURL: process.env.SUB2API_BASE_URL,   // e.g. https://your-host/v1
  apiKey: process.env.SUB2API_API_KEY,
});
```

### Test Cases

- **1.1 Basic completion** — send prompt, receive response, measure latency
- **1.2 Streaming** — SSE format, consumable by `useChat` on the frontend
- **1.3 Tool calling** — register an echo tool, model invokes it, result returns
- **1.4 Multi-step tool calling** — multiple tools, `maxSteps` loop, mid-chain error handling

### Success Criteria

- sub2api accepts requests from Vercel AI SDK using the configured model name
- Streaming works end-to-end
- Tool-calling loop executes and results feed back to the model
- Errors (timeout, model unavailable, tool failure) are handled cleanly

### Blocker

⚠️ Need the **sub2api base URL, API key, and the list of available model names**
(e.g. `deepseek-chat`). The service is already deployed on the user's server; we just
need connection details in `.env`.

---

## 2. OpenCode Skills Service Integration

### Objective

Verify the backend can drive the OpenCode Skills Service over HTTP to run a
SKILL.md-based capability, and that OpenCode's own model calls route through sub2api.

### Contract (from `docs/对接/OpenCode执行后端-协作与接口契约.md`)

- `POST /v1/runs` — start a run `{ run_id, skill, skill_version, input, model, ... }` → `202`
- `GET /v1/runs/{run_id}` — poll status → `succeeded | failed | running | canceled` + `output` + `usage`
- `GET /health` — `{ status, skills: [...], opencode: "reachable" }`
- Auth: `Authorization: Bearer <OPENCODE_API_TOKEN>`

### Test Cases

- **2.1 Health** — `GET /health` returns ok and lists installed skills
- **2.2 Run a skill (sync/async_poll)** — submit a hello-world skill, get structured output
- **2.3 Node integration** — call from the backend, parse output, handle errors/timeouts
- **2.4 As a tool adapter** — wrap in `OpenCodeSkillAdapter`, register as a Vercel AI SDK tool

### Success Criteria

- Backend reaches the service and lists skills
- A skill run completes and returns structured output + usage
- Adapter integrates cleanly with the Vercel AI SDK tool loop

### Blocker

⚠️ Need to know whether the OpenCode Skills Service is **already deployed** (→ provide
`OPENCODE_API_BASE_URL` + token) or **not yet** (→ decide whether to deploy it separately
based on `opencode-skiills-service`). Also need one sample skill name for the hello-world test.

---

## 3. End-to-End Integration Test

### Scenario

**Digital Employee**: "E-commerce Product Assistant"
**User prompt**: "Generate a product description for a wireless keyboard"

**Expected flow**:
1. User message → Digital Employee (Vercel AI SDK, model via sub2api)
2. Model decides to call the `generate_product_description` tool
3. `OpenCodeSkillAdapter` calls the OpenCode service over HTTP
4. OpenCode runs the skill; its model call goes through sub2api
5. Result returns to the model → final response streams back to the user

### Success Metrics

- Full flow runs without errors, tool is invoked, response includes skill output
- End-to-end latency reasonable (< ~10s for the test skill)
- No hung requests / leaked connections

---

## Risk Assessment

### High Risk (resolve before Layer 2)

1. **sub2api connection details missing** — can't test anything until provided.
2. **OpenCode service availability** — if not deployed, need a decision on deploying it
   or prioritizing Coze/Dify agents first for the MVP.

### Medium Risk

3. **Latency** — relay + OpenCode HTTP round-trips per tool call; benchmark early.
4. **Error-handling surface** — many failure points (network, model, skill run); need a
   consistent error framework across adapters.

### Low Risk

5. **OpenAI-format edge cases** — minor incompatibilities in the sub2api response shape;
   add a thin normalization layer if needed.

---

## Next Steps

1. **Get sub2api details** → fill `.env` → verify with `curl $SUB2API_BASE_URL/models`
2. **Clarify OpenCode service status** → fill `.env` or plan deployment
3. **Implement the test endpoints** in `apps/platform-api/src/modules/test/` (currently
   stubs returning `not_implemented` with a `blockedBy` field)
4. **Decision point**: all green → Layer 2; sub2api blocked → mock; OpenCode blocked →
   prioritize Coze/Dify path first

---

## Open Questions

1. **sub2api**: base URL, key, and available model names?
2. **OpenCode**: deployed already? URL + token? one sample skill name for testing?
3. **Strategy**: if OpenCode isn't ready, do we ship the MVP on Coze/Dify agents +
   simple prompt-template skills (LLM via sub2api) first, and add OpenCode later?

---

## Status Log

**2026-07-23**
- Layer 0 infrastructure complete ✅ (DB, Docker, backend running)
- Layer 1 validation plan written and aligned to real services (sub2api + OpenCode HTTP) ✅
- Test endpoints scaffolded as stubs (report `blockedBy` based on env config) ✅
- **Blocked on**: sub2api connection details; OpenCode service status
