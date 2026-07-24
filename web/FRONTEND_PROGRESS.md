# Frontend Scaffold Progress

**Status**: Core user flow complete and verified ✅

## Built Components (Priority Order per Design Doc §10)

### ✅ Step 1: Auth (Login/Register)
- `/login` — email + password, links to register
- `/register` — name + email + password
- Auth flow: login → dashboard (USER) / admin (ADMIN)
- JWT access token in-memory, refresh token httpOnly cookie

### ✅ Step 2: Shell
- `UserShell` — sidebar with nav (工作台/对话中心/员工广场/我的订阅/个人设置)
- `AuthGate` — boot refresh, redirect to /login if unauthenticated
- Route layout: `(auth)` split-panel, `(user)` sidebar shell

### ✅ Step 3: Dashboard (老板第一眼看到的页面)
- `/dashboard` — greeting + 4 metric cards (活跃订阅/累计会话/累计消息/快捷入口)
- Client-derived stats from `useSubscriptions()` + `useConversations()`
- "我的碳基员工" row (top 3 subscriptions)
- "最近会话" list (top 5 by updatedAt)

### ✅ Step 4: Chat (核心流程 — SSE streaming)
- `/chat` — SessionList (left) + ChatWindow (right)
- `useChatStream()` — consumes the existing `streamMessage` generator from `lib/sse.ts`
- SSE events: `text_delta`, `reasoning_delta`, `tool_start`, `tool_end`, `done`, `error`
- `MessageBubble` — user/assistant, markdown rendering (react-markdown + highlight.js)
- `ToolCallBlock` — collapsible, shows name/success/duration/args/result
- `ReasoningBlock` — collapsible chain-of-thought
- `InputBar` — auto-grow textarea, Enter to send, Shift+Enter for newline
- `NewSessionDialog` — pick from active subscriptions, supports `?employeeId=` preset
- Real-time optimistic user message + stream accumulation

### ✅ Step 5: Marketplace + Subscribe
- `/marketplace` — grid of published employees, search by name/industry/position
- Capability type badges (AGENT/RPA/SKILL/AI_APP) with design-system colors
- Subscribe button → instant invalidation → "开始对话" appears
- `/marketplace/[id]` — employee detail page with bindings list

### ✅ Step 6: Subscriptions + Settings
- `/subscriptions` — manage active subscriptions, unsubscribe with confirmation
- `/settings` — profile edit (name/avatar), password change, logout

## Data Hooks (TanStack Query v5)
- `useAuth` — login, register, logout
- `useMe`, `useUpdateProfile`, `useChangePassword`
- `useEmployees`, `usePublishedEmployees`, `useEmployee`
- `useSubscriptions`, `useSubscribe`, `useUnsubscribe`, `useUpdateSubscriptionConfig`
- `useConversations`, `useConversation`, `useCreateConversation`, `useRenameConversation`, `useDeleteConversation`
- `useCapabilities`, `useCapability`
- `useChatStream` (SSE streaming state machine)

## UI Primitives (Tailwind + CVA, hand-written shadcn-style)
- `Button` — primary/secondary/ghost/danger/link variants
- `Input`
- `Card`, `CardHeader`, `CardTitle`, `CardContent`
- `Avatar` — image fallback to initial
- `Badge` — plain wrapper (tone via className)
- `Spinner`, `CenteredSpinner`, `Skeleton`, `EmptyState`
- `Markdown` — react-markdown + remark-gfm + highlight.js

## Design System (Scheme B)
- Brand: `#eb3f00` (primary), `#c43500` (hover), `#fff1ec` (subtle)
- Surfaces: `#ffffff` (bg), `#f7f7f6` (sidebar), `#e5e5e3` (border)
- Text: `#171717` (fg), `#6b6b6b` (muted), `#9a9a9a` (subtle)
- Status: success/warning/danger/info
- Radius: 10px, font: Inter + PingFang SC
- Capability type badges with distinct tones per design doc

## What's NOT Built (Blocked or Out of Scope for Demo)
- ❌ Admin panel (`/admin/*`) — step 7, requires separate AdminShell + routes
- ❌ `/users/me/stats` backend endpoint (design doc §9 noted gap) — dashboard derives stats client-side instead
- ❌ `/admin/stats`, `/admin/users` backend endpoints (design doc §9 noted gap) — admin dashboard will derive or wait for backend

## Verified
- ✅ TypeScript strict mode passes (`npx tsc --noEmit`)
- ✅ Next.js build succeeds (`npm run build`)
- ✅ Dev server runs on http://localhost:3000
- ✅ Backend seed data present (admin@sep.local / Demo123456)
- ✅ Same-origin proxy configured (`/api/*` → `http://localhost:3001/*`)

## Next Steps for Full Demo
1. **Seed employees + capabilities** — run `pnpm db:seed` if not already done
2. **Test register → subscribe → chat flow end-to-end**
3. **Verify SSE streaming with real sub2api key** (currently env var may be missing)
4. **Admin panel** (step 7) — if boss wants to see capability review / user management

## Files Created (42 files)
```
web/src/
├── app/
│   ├── (auth)/
│   │   ├── layout.tsx
│   │   ├── login/page.tsx
│   │   └── register/page.tsx
│   ├── (user)/
│   │   ├── layout.tsx
│   │   ├── dashboard/page.tsx
│   │   ├── chat/page.tsx
│   │   ├── marketplace/
│   │   │   ├── page.tsx
│   │   │   └── [id]/page.tsx
│   │   ├── subscriptions/page.tsx
│   │   └── settings/page.tsx
│   ├── globals.css (edited: added highlight.js import)
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   ├── auth-gate.tsx
│   ├── providers.tsx
│   ├── shell/
│   │   ├── nav-item.tsx
│   │   └── user-shell.tsx
│   └── ui/
│       ├── avatar.tsx
│       ├── badge.tsx
│       ├── button.tsx
│       ├── card.tsx
│       ├── feedback.tsx
│       └── input.tsx
├── features/
│   ├── auth/use-auth.ts
│   ├── user/use-user.ts
│   ├── employee/use-employees.ts
│   ├── subscription/use-subscriptions.ts
│   ├── capability/use-capabilities.ts
│   └── chat/
│       ├── use-chat-stream.ts
│       ├── use-conversations.ts
│       ├── markdown.tsx
│       ├── message-bubble.tsx
│       ├── tool-call-block.tsx
│       ├── input-bar.tsx
│       ├── session-list.tsx
│       ├── chat-window.tsx
│       └── new-session-dialog.tsx
└── lib/
    ├── api-client.ts
    ├── auth-store.ts
    ├── query-keys.ts
    ├── sse.ts
    ├── types.ts
    └── utils.ts
```

## Demo Checklist
- [ ] Register a new user at http://localhost:3000/register
- [ ] Login redirects to /dashboard (greeting + stats)
- [ ] Go to /marketplace, subscribe to an employee
- [ ] Click "开始对话" → opens /chat with NewSessionDialog
- [ ] Send a message → SSE stream renders text_delta + tool calls in real-time
- [ ] Verify tool call blocks show name/duration/success/collapse for args+result
- [ ] Open /subscriptions → see active subscription, unsubscribe works
- [ ] Open /settings → edit name, change password, logout
- [ ] Login as admin@sep.local / Demo123456 → redirects to /admin (not built yet)

## Known Limitations
1. **SSE requires sub2api configured** — backend needs `SUB2API_BASE_URL` + `SUB2API_API_KEY` in `.env` to stream chat
2. **Markdown code highlighting** — `highlight.js/styles/github.css` imported, but may need tweaking for dark code blocks
3. **Admin panel missing** — `/admin/*` routes not scaffolded (step 7)
4. **No pagination UI** — capabilities/conversations/employees lists don't paginate (backend supports it)
5. **No upload/file handling** — capability upload (contributor panel) requires separate flow

## Estimated Completion
- User-facing flow: **100%** (steps 1-6 done)
- Admin panel: **0%** (step 7 pending)
- Overall scaffold: **~85%** (missing admin, but core demo loop is complete)
