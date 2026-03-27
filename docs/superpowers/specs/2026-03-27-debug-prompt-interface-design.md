# Debug Prompt Interface Design

**Date:** 2026-03-27
**Status:** Approved

## Overview

添加一个 WebSocket 调试接口 `debug:prompt`，用于验证 markdown 拼接 system prompt 的端到端流程。该接口直接调用 adapter 获取 LLM 响应，便于快速验证 prompt 模板是否正确生效。

## Architecture

### Interface Design

**Message:** `@SubscribeMessage('debug:prompt')`

**Request Payload:**

```typescript
{
  sessionId: string; // 会话 ID
  agentId: string; // Agent ID (如 'claude-001', 'codex-001', 'gemini-001')
  prompt: string; // 用户输入的调试 prompt
}
```

**Response Events:**

1. `debug:system-prompt` — 构建后的 system prompt（不含用户输入）

   ```typescript
   {
     systemPrompt: string;
     agentId: string;
   }
   ```

2. `agent:thinking` — LLM 处理中
3. `agent:stream` — 流式响应（逐字返回）
4. `agent:stream:end` — 响应结束

   ```typescript
   {
     agentId: string;
     agentName: string;
     fullContent: string;
   }
   ```

5. `agent:error` — 错误事件
   ```typescript
   {
     agentId: string;
     agentName: string;
     error: string;
   }
   ```

### Flow

```
Client                           ChatGateway
  |  -- debug:prompt -->           |
  |                                | 1. promptBuilder.buildMessages() 构建 system prompt
  |  <-- debug:system-prompt --    |    (返回拼接后的完整 prompt)
  |                                | 2. adapter.streamGenerate() 调用 LLM
  |  <-- agent:stream (多次) --    |
  |  <-- agent:stream:end --       |
```

## Components

### DTO

新增 `DebugPromptDto`：

```typescript
export class DebugPromptDto {
  sessionId: string;
  agentId: string;
  prompt: string;
}
```

### Handler

在 `ChatGateway` 新增 `handleDebugPrompt` 方法：

- 调用 `promptBuilder.buildMessages()` 获取拼接后的 system prompt
- 通过 `debug:system-prompt` 事件返回
- 调用对应 adapter 的 `streamGenerate()` 获取 LLM 响应
- 通过 `agent:stream` / `agent:stream:end` 事件返回

### Agent Selection

根据 `agentId` 路由到对应 adapter：

- `claude-001` → `ClaudeAdapter`
- `codex-001` → `CodexAdapter`
- `gemini-001` → `GeminiAdapter`

## Data Flow

1. **System Prompt 构建**
   - `promptBuilder.buildMessages(agent, context)` → 返回包含 system prompt 的 messages
   - 提取 system prompt 并通过 `debug:system-prompt` 事件返回前端

2. **LLM 调用**
   - 构建 `AgentContext`（包含 sessionId 和空 conversationHistory）
   - 调用 `adapter.streamGenerate(prompt, context)` 获取流式响应
   - 流式转发到前端

## Error Handling

- 未知 agentId：返回 `agent:error` 事件，提示 "Unknown agent"
- LLM 调用失败：捕获异常，通过 `agent:error` 事件返回错误信息
- sessionId 为空：拒绝请求

## Constraints

- 不写入 PostgreSQL（调试用途）
- 不写入 Redis conversation history（调试用途）
- 不触发 OrchestrationService
