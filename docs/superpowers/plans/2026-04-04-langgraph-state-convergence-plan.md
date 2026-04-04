# LangGraph State Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep LangGraph as the orchestration layer while converging multi-agent state into one session-context source of truth and a much smaller runtime graph state.

**Architecture:** Split the current orchestration data into three explicit layers: `SessionContext` for agent-visible history, `WorkflowRuntimeState` for LangGraph control flow, and `ExecutionTrace` for audit/debug data. Refactor the graph to read agent context only from the session context service, emit structured run results instead of free-form state mutations, and derive UI events from those results rather than treating events as business state.

**Tech Stack:** TypeScript, NestJS, LangGraph StateGraph, Jest, WebSocket, TypeORM, Redis

---

## File Structure

### Files to Create

- `src/orchestration/context/session-context.types.ts` - canonical session-turn, handoff summary, and session context types
- `src/orchestration/context/session-context.service.ts` - single source of truth for loading/appending agent-visible session context
- `src/orchestration/context/session-context.service.spec.ts` - unit tests for session context load/append/summary behavior
- `src/orchestration/runtime/agent-run-result.ts` - structured output for one agent run
- `src/orchestration/runtime/handoff.directive.ts` - structured handoff control payload
- `src/orchestration/runtime/workflow-run-config.ts` - typed orchestration config replacing ad hoc metadata
- `src/orchestration/runtime/execution-trace.types.ts` - trace model separated from runtime state

### Files to Modify

- `src/orchestration/state/workflow.state.ts` - shrink to `WorkflowRuntimeState`; remove message/history ownership
- `src/orchestration/state/workflow.state.spec.ts` - update assertions to the reduced runtime state
- `src/orchestration/graph/workflow.graph.ts` - read session context from service, return structured run results, clear stale handoff/output state
- `src/orchestration/orchestration.service.ts` - create initial runtime state, derive events from structured results, stop merging pseudo-global state
- `src/orchestration/orchestration.service.spec.ts` - test runtime state transitions and event derivation
- `src/orchestration/handoff/output-parser.ts` - return structured handoff/review parse results suitable for `AgentRunResult`
- `src/orchestration/handoff/output-parser.spec.ts` - cover new parse contract
- `src/memory/services/conversation-history.service.ts` - either narrow responsibility to legacy adapter or route through session context service
- `src/memory/services/conversation-history.service.spec.ts` - reflect new role or deprecation boundary
- `src/gateway/chat.gateway.ts` - keep persistence/event forwarding aligned with session context ownership
- `src/gateway/chat.gateway.spec.ts` - verify no duplicate persistence and correct workflow events
- `src/agents/interfaces/llm-adapter.interface.ts` - keep agent context shape consistent with the converged session context
- `src/agents/utils/build-chat-messages.ts` - consume only the canonical message shape
- `src/agents/prompts/prompt-builder.ts` - consume only canonical session history fields
- `src/orchestration/chain-of-thought/cot-writer.service.ts` - keep trace/audit writes detached from workflow runtime state

### Files to Review Before Editing

- `src/memory/services/short-term-memory.service.ts`
- `src/common/types/message.types.ts`
- `src/gateway/agent-router.ts`
- `src/agents/react/react-executor.service.ts`
- `src/agents/react/utils/parse-react-tags.spec.ts`

---

## Target Design Rules

- `SessionContext` is the only source of truth for agent-visible history.
- `WorkflowRuntimeState` contains only orchestration control data for the current graph execution.
- `ExecutionTrace` is audit-only and never reused as prompt history.
- `WorkflowEvent` is derived from runtime state transitions or `AgentRunResult`, never stored as business state.
- Handoff uses two channels only:
  - `HandoffDirective` for control flow
  - `handoff_summary` turn for the next agent's usable context
- `metadata: Record<string, unknown>` is not allowed in the converged runtime state.

---

## Task 1: Introduce Canonical Session Context Types

**Files:**

- Create: `src/orchestration/context/session-context.types.ts`
- Modify: `src/agents/interfaces/llm-adapter.interface.ts`
- Modify: `src/common/types/message.types.ts`
- Test: `src/orchestration/context/session-context.service.spec.ts`

- [ ] **Step 1: Write the failing type-first test for canonical turn shape**

Create `src/orchestration/context/session-context.service.spec.ts` with assertions around a canonical turn shape:

```ts
import type { SessionTurn } from './session-context.types';

describe('SessionTurn', () => {
  it('supports user, assistant, system, and handoff_summary kinds', () => {
    const turn: SessionTurn = {
      id: 'turn-1',
      sessionId: 'session-1',
      role: 'assistant',
      kind: 'handoff_summary',
      content: 'Completed analysis, next agent should implement the refactor.',
      agentName: 'Claude',
      createdAt: new Date(),
    };

    expect(turn.kind).toBe('handoff_summary');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- orchestration/context/session-context.service.spec.ts`
Expected: FAIL because `session-context.types.ts` does not exist yet

- [ ] **Step 3: Create the canonical types**

Create `src/orchestration/context/session-context.types.ts` with a small, explicit model:

```ts
export type SessionTurnKind = 'user' | 'assistant' | 'system' | 'handoff_summary';

export interface SessionTurn {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  kind: SessionTurnKind;
  content: string;
  agentId?: string;
  agentName?: string;
  createdAt: Date;
}

export interface SessionContext {
  sessionId: string;
  turns: SessionTurn[];
}
```

Update `src/agents/interfaces/llm-adapter.interface.ts` so `AgentContext.conversationHistory` references the canonical session turn type or a clearly compatible alias, not a parallel bespoke message shape.

- [ ] **Step 4: Run the focused tests**

Run: `npm test -- orchestration/context/session-context.service.spec.ts agents/prompts/prompt-builder.spec.ts`
Expected: PASS or only fail where downstream types have not yet been updated

- [ ] **Step 5: Commit**

```bash
git add src/orchestration/context/session-context.types.ts src/orchestration/context/session-context.service.spec.ts src/agents/interfaces/llm-adapter.interface.ts src/common/types/message.types.ts
git commit -m "refactor(orchestration): introduce canonical session context types"
```

---

## Task 2: Add SessionContextService as the Single History Source

**Files:**

- Create: `src/orchestration/context/session-context.service.ts`
- Create: `src/orchestration/context/session-context.service.spec.ts`
- Modify: `src/memory/services/conversation-history.service.ts`
- Modify: `src/memory/services/conversation-history.service.spec.ts`
- Review: `src/memory/services/short-term-memory.service.ts`

- [ ] **Step 1: Write the failing service tests**

Add tests for:

- loading session turns from the current memory layer
- appending an assistant turn
- appending a `handoff_summary` turn
- returning recent turns in the same shape the agents consume

Suggested skeleton:

```ts
describe('SessionContextService', () => {
  it('loads recent turns as canonical session turns', async () => {});
  it('appends assistant turns without changing prior turns', async () => {});
  it('appends handoff summary turns for the next agent', async () => {});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- orchestration/context/session-context.service.spec.ts`
Expected: FAIL because the service does not exist yet

- [ ] **Step 3: Implement the minimal service**

Create `src/orchestration/context/session-context.service.ts` with a narrow API:

```ts
export class SessionContextService {
  async getContext(sessionId: string): Promise<SessionContext> {}
  async appendUserTurn(sessionId: string, input: AppendTurnInput): Promise<SessionTurn> {}
  async appendAssistantTurn(sessionId: string, input: AppendTurnInput): Promise<SessionTurn> {}
  async appendHandoffSummary(sessionId: string, input: AppendTurnInput): Promise<SessionTurn> {}
}
```

Use the existing memory services as storage adapters initially. Do not add new persistence layers in this task.

- [ ] **Step 4: Convert `ConversationHistoryService` into a compatibility wrapper**

Keep the class temporarily, but make its implementation explicitly delegate to `SessionContextService` or mark it deprecated and narrow its API. Remove the misleading unused `agentId` behavior from its contract in this step if possible.

- [ ] **Step 5: Run the focused tests**

Run: `npm test -- orchestration/context/session-context.service.spec.ts memory/services/conversation-history.service.spec.ts memory/services/short-term-memory.service.spec.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/orchestration/context/session-context.service.ts src/orchestration/context/session-context.service.spec.ts src/memory/services/conversation-history.service.ts src/memory/services/conversation-history.service.spec.ts
git commit -m "refactor(orchestration): add session context service as history source"
```

---

## Task 3: Shrink WorkflowState into WorkflowRuntimeState

**Files:**

- Modify: `src/orchestration/state/workflow.state.ts`
- Modify: `src/orchestration/state/workflow.state.spec.ts`
- Create: `src/orchestration/runtime/agent-run-result.ts`
- Create: `src/orchestration/runtime/handoff.directive.ts`
- Create: `src/orchestration/runtime/workflow-run-config.ts`

- [ ] **Step 1: Write the failing runtime-state test**

Update `src/orchestration/state/workflow.state.spec.ts` to assert that runtime state owns only control data:

```ts
expect(state).toEqual({
  sessionId: 'session-1',
  entryMessageId: 'msg-1',
  activeAgent: null,
  pendingHandoff: null,
  planInput: '',
  lastAgentResult: null,
  control: {
    needsReview: false,
    hasError: false,
  },
  status: 'routing',
  config: {
    mentionedAgents: [],
    useReAct: true,
    reactMaxSteps: 10,
  },
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- orchestration/state/workflow.state.spec.ts`
Expected: FAIL because the current state shape is much larger

- [ ] **Step 3: Implement the reduced runtime state and structured result types**

Refactor `src/orchestration/state/workflow.state.ts` so it defines a small runtime state. Add the structured result files with shapes like:

```ts
export interface HandoffDirective {
  targetAgent: string;
  reason?: string;
  summaryForNextAgent?: string;
}

export interface AgentRunResult {
  agentName: string;
  rawOutput: string;
  cleanOutput: string;
  needsReview: boolean;
  handoff: HandoffDirective | null;
  errorMessage?: string;
}
```

Move `useReAct`, `reactMaxSteps`, and `mentionedAgents` into `WorkflowRunConfig`. Remove `messages`, `pendingTasks`, `completedTasks`, `chainOfThought`, `reasoningSteps`, `isComplete`, and untyped `metadata` from runtime state.

- [ ] **Step 4: Run the focused tests**

Run: `npm test -- orchestration/state/workflow.state.spec.ts orchestration/handoff/output-parser.spec.ts`
Expected: PASS or only fail where downstream code still expects the old shape

- [ ] **Step 5: Commit**

```bash
git add src/orchestration/state/workflow.state.ts src/orchestration/state/workflow.state.spec.ts src/orchestration/runtime/agent-run-result.ts src/orchestration/runtime/handoff.directive.ts src/orchestration/runtime/workflow-run-config.ts
git commit -m "refactor(orchestration): shrink workflow runtime state"
```

---

## Task 4: Refactor Output Parsing and Handoff Into Structured Results

**Files:**

- Modify: `src/orchestration/handoff/output-parser.ts`
- Modify: `src/orchestration/handoff/output-parser.spec.ts`
- Review: `src/agents/react/utils/parse-react-tags.spec.ts`

- [ ] **Step 1: Write the failing parser tests**

Add tests for:

- extracting `needsReview`
- extracting a structured handoff target
- producing `cleanOutput`
- preserving room for a generated handoff summary

Suggested assertion:

```ts
expect(parseAgentOutput('done<handoff_agent>Codex</handoff_agent>')).toMatchObject({
  needsReview: false,
  cleanOutput: 'done',
  handoff: { targetAgent: 'Codex' },
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- orchestration/handoff/output-parser.spec.ts`
Expected: FAIL because the parser still returns `nextAgent`

- [ ] **Step 3: Implement the structured parser contract**

Return a parsed result aligned with `AgentRunResult` and `HandoffDirective`. Do not return generic `hasError: false`; only include fields the parser truly owns.

- [ ] **Step 4: Run the focused tests**

Run: `npm test -- orchestration/handoff/output-parser.spec.ts agents/react/utils/parse-react-tags.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/orchestration/handoff/output-parser.ts src/orchestration/handoff/output-parser.spec.ts
git commit -m "refactor(orchestration): structure handoff and output parsing"
```

---

## Task 5: Rebuild the LangGraph Flow Around SessionContextService

**Files:**

- Modify: `src/orchestration/graph/workflow.graph.ts`
- Modify: `src/orchestration/orchestration.service.ts`
- Modify: `src/orchestration/orchestration.service.spec.ts`
- Modify: `src/orchestration/graph/workflow.graph.spec.ts`
- Modify: `src/orchestration/chain-of-thought/cot-writer.service.ts`

- [ ] **Step 1: Write failing graph and orchestration tests**

Add tests proving:

- `run_task` reads history from `SessionContextService`, not `state.messages`
- `run_task` appends the assistant turn back to session context
- handoff writes a `handoff_summary` turn when the parser returns a summary
- `ROUTE_AGENT` clears stale handoff state before the next run
- `stateToEvent` derives events from `lastAgentResult` and control flags, not from ad hoc field combinations

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `npm test -- orchestration/graph/workflow.graph.spec.ts orchestration/orchestration.service.spec.ts`
Expected: FAIL because the graph still depends on the old state model

- [ ] **Step 3: Refactor `workflow.graph.ts`**

Change node behavior to:

- `HYDRATE`: validate session and return unchanged runtime control state
- `ROUTE`: select `activeAgent` from `config.mentionedAgents` or parsed mention
- `RUN_TASK`: fetch session context from `SessionContextService`, call agent, build `AgentRunResult`, append assistant turn, optionally append `handoff_summary`, write trace
- `CHECK_OUTPUT`: set `pendingHandoff`, `control.needsReview`, `control.hasError`, and `status`
- `ROUTE_AGENT`: move `pendingHandoff.targetAgent` into `activeAgent`, then clear `pendingHandoff` and `lastAgentResult`
- `HANDLE_ERROR`: transition into review/failed status without inventing extra state

- [ ] **Step 4: Refactor `orchestration.service.ts`**

Create initial runtime state without `messages`. Derive events from:

- `status`
- `activeAgent`
- `lastAgentResult`
- `pendingHandoff`
- `control`

Do not merge arbitrary partial state objects into a pseudo-global mutable state if LangGraph already provides the current state snapshot.

- [ ] **Step 5: Keep audit writes separate**

Update `cot-writer.service.ts` or its call site so trace writes consume `AgentRunResult` or explicit trace objects. Do not store trace arrays inside runtime state.

- [ ] **Step 6: Run the focused tests**

Run: `npm test -- orchestration/graph/workflow.graph.spec.ts orchestration/orchestration.service.spec.ts orchestration/chain-of-thought/cot-writer.service.spec.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/orchestration/graph/workflow.graph.ts src/orchestration/graph/workflow.graph.spec.ts src/orchestration/orchestration.service.ts src/orchestration/orchestration.service.spec.ts src/orchestration/chain-of-thought/cot-writer.service.ts
git commit -m "refactor(orchestration): drive langgraph from session context"
```

---

## Task 6: Align Gateway Persistence and Events With the New Ownership Model

**Files:**

- Modify: `src/gateway/chat.gateway.ts`
- Modify: `src/gateway/chat.gateway.spec.ts`

- [ ] **Step 1: Write the failing gateway tests**

Add assertions that:

- the user turn is appended once to session context before orchestration runs
- assistant turns are not duplicated between `run_task` and gateway persistence
- workflow events are forwarded from orchestration output only
- `agent:stream:end` persistence does not reintroduce a second business-state source

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- gateway/chat.gateway.spec.ts`
Expected: FAIL because current ownership is split between graph, gateway, and conversation history service

- [ ] **Step 3: Refactor gateway ownership**

Choose one ownership path and make it explicit:

- gateway owns user-turn append
- `run_task` owns assistant-turn append into `SessionContextService`
- gateway owns transcript/DB mirror persistence only if it does not mutate agent-visible history separately

If necessary, rename helper methods to make ownership obvious, for example:

```ts
private async mirrorAssistantTurnToDatabase(...)
private async mirrorAssistantTurnToTranscript(...)
```

- [ ] **Step 4: Run the focused tests**

Run: `npm test -- gateway/chat.gateway.spec.ts orchestration/orchestration.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/gateway/chat.gateway.ts src/gateway/chat.gateway.spec.ts
git commit -m "refactor(gateway): align persistence with session context ownership"
```

---

## Task 7: Remove Deprecated Fields and Compatibility Paths

**Files:**

- Modify: `src/orchestration/state/workflow.state.ts`
- Modify: `src/memory/services/conversation-history.service.ts`
- Modify: `src/agents/prompts/prompt-builder.ts`
- Modify: `src/agents/utils/build-chat-messages.ts`
- Modify: any affected specs

- [ ] **Step 1: Write the failing cleanup tests**

Add or update tests asserting:

- no runtime code references `state.messages`
- no runtime code reads `metadata.useReAct` or `metadata.reactMaxSteps`
- no event derivation depends on `nextAgent === currentAgent`
- prompt building works from canonical session turns

- [ ] **Step 2: Run targeted search and tests**

Run: `rg -n "state\\.messages|pendingTasks|completedTasks|chainOfThought|metadata\\.useReAct|metadata\\.reactMaxSteps|nextAgent === state\\.currentAgent" src`
Expected: remaining matches only in migration comments or deleted-code candidates

Run: `npm test -- agents/prompts/prompt-builder.spec.ts orchestration/state/workflow.state.spec.ts`
Expected: FAIL until cleanup is complete

- [ ] **Step 3: Remove the deprecated paths**

Delete or rewrite the compatibility code that still exposes the old state shape. Keep comments short and explicit where migration boundaries remain.

- [ ] **Step 4: Run the focused tests**

Run: `npm test -- agents/prompts/prompt-builder.spec.ts orchestration/state/workflow.state.spec.ts memory/services/conversation-history.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/orchestration/state/workflow.state.ts src/memory/services/conversation-history.service.ts src/agents/prompts/prompt-builder.ts src/agents/utils/build-chat-messages.ts
git commit -m "refactor(orchestration): remove deprecated state and metadata paths"
```

---

## Task 8: Full Verification

**Files:**

- Test only

- [ ] **Step 1: Run the orchestration-focused suite**

Run: `npm test -- orchestration`
Expected: PASS

- [ ] **Step 2: Run gateway and memory suites**

Run: `npm test -- gateway/chat.gateway.spec.ts memory/services/short-term-memory.service.spec.ts memory/services/conversation-history.service.spec.ts`
Expected: PASS

- [ ] **Step 3: Run full unit test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Run lint**

Run: `npm run lint`
Expected: PASS with no new warnings or errors

- [ ] **Step 5: Run build/typecheck**

Run: `npm run build`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: verify langgraph state convergence refactor"
```

---

## Migration Notes

- Do not attempt a big-bang rewrite of memory, gateway, graph, and prompts in one commit.
- Preserve LangGraph throughout; the refactor is about state ownership, not replacing the orchestrator.
- Prefer adapter-style compatibility in Tasks 1-4, then remove old fields in Task 7.
- If a step reveals a hidden dependency on old workflow state fields in unrelated modules, stop and document the dependency before extending the runtime state again.

## Done Criteria

- [ ] Agent-visible history comes only from `SessionContextService`
- [ ] LangGraph runtime state no longer stores complete message history
- [ ] Handoff uses `HandoffDirective` plus optional `handoff_summary` turn
- [ ] Audit trace is stored outside runtime state
- [ ] Gateway no longer duplicates agent-visible history writes
- [ ] `metadata: Record<string, unknown>` is gone from workflow runtime state
- [ ] No production code path depends on `state.messages`
- [ ] Tests, lint, and build pass

## Execution Order

1. Introduce canonical types
2. Add the session context service
3. Shrink runtime state
4. Structure parser and handoff
5. Refactor graph and orchestration
6. Align gateway ownership
7. Remove deprecated paths
8. Verify everything
