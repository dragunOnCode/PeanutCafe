# Debug Prompt Interface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add WebSocket debug interface to verify markdown拼接到system prompt的效果

**Architecture:** 在 ChatGateway 新增 `debug:prompt` handler，复用 `handleAgentResponse` 的流式响应能力，调用前通过 `debug:system-prompt` 事件返回构建后的 system prompt

**Tech Stack:** NestJS WebSocket, Socket.IO

---

## File Structure

- **Create:** `src/gateway/dto/debug-prompt.dto.ts`
- **Modify:** `src/gateway/chat.gateway.ts:248-394`

---

## Tasks

### Task 1: Create DebugPromptDto

**Files:**

- Create: `src/gateway/dto/debug-prompt.dto.ts`

- [ ] **Step 1: Write DTO**

```typescript
import { IsString, IsNotEmpty } from 'class-validator';

export class DebugPromptDto {
  @IsString()
  @IsNotEmpty()
  sessionId: string;

  @IsString()
  @IsNotEmpty()
  agentId: string;

  @IsString()
  @IsNotEmpty()
  prompt: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/gateway/dto/debug-prompt.dto.ts
git commit -m "feat(gateway): add DebugPromptDto for debug interface"
```

---

### Task 2: Add handleDebugPrompt handler

**Files:**

- Modify: `src/gateway/chat.gateway.ts`

- [ ] **Step 1: Add import for DTO**

在文件顶部找到现有 DTO imports，添加：

```typescript
import { DebugPromptDto } from './dto/debug-prompt.dto';
```

- [ ] **Step 2: Add handler method**

在 `handleAgentResponse` 方法之前（第250行前）添加：

```typescript
@SubscribeMessage('debug:prompt')
async handleDebugPrompt(
  @ConnectedSocket() client: Socket,
  @MessageBody() dto: DebugPromptDto,
): Promise<void> {
  const agent = this.agentRouter.getAgentById(dto.agentId);
  if (!agent) {
    client.emit('agent:error', {
      agentId: dto.agentId,
      agentName: 'unknown',
      error: `Unknown agent: ${dto.agentId}`,
      timestamp: new Date(),
    });
    return;
  }

  const context: AgentContext = {
    sessionId: dto.sessionId,
    conversationHistory: [],
  };

  const messages = await this.promptBuilder.buildMessages(
    {
      id: agent.id,
      name: agent.name,
      type: agent.type,
      role: agent.role,
      capabilities: agent.capabilities,
      model: agent.model,
    },
    context,
  );

  const systemPrompt = messages[0].content;
  client.emit('debug:system-prompt', {
    agentId: agent.id,
    systemPrompt,
  });

  try {
    await this.handleAgentResponse(dto.sessionId, agent);
  } catch (error) {
    client.emit('agent:error', {
      agentId: agent.id,
      agentName: agent.name,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date(),
    });
  }
}
```

- [ ] **Step 3: Verify syntax**

Run: `npx tsc --noEmit src/gateway/chat.gateway.ts`

- [ ] **Step 4: Commit**

```bash
git add src/gateway/chat.gateway.ts src/gateway/dto/debug-prompt.dto.ts
git commit -m "feat(gateway): add debug:prompt handler for system prompt verification"
```

---

## Verification

### Manual Test

1. 启动服务器：`npm run start:dev`
2. 连接 Socket.IO 到 `/chat` namespace
3. 发送消息：

```json
{
  "event": "debug:prompt",
  "data": {
    "sessionId": "test-session-001",
    "agentId": "claude-001",
    "prompt": "Hello, who are you?"
  }
}
```

4. 预期收到：
   - `debug:system-prompt` — 包含拼接后的完整 system prompt
   - `agent:thinking` — LLM 处理中
   - `agent:stream` — 流式响应
   - `agent:stream:end` — 响应结束

### Expected Events Flow

```
Client -> [debug:prompt] -> Server
Server -> [debug:system-prompt] -> Client (system prompt for debugging)
Server -> [agent:thinking] -> Client
Server -> [agent:stream] -> Client (multiple chunks)
Server -> [agent:stream:end] -> Client
```
