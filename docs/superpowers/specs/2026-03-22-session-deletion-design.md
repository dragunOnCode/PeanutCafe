# Session Deletion Design

> **Goal:** 实现 session 删除功能，删除 session 后该对话内所有消息都会被删除（包括 Redis 短期记忆、PostgreSQL 数据库、workspace 消息记录）。删除操作具有重试机制保证最终成功。

## Architecture Overview

```
ChatGateway (WebSocket)
    │
    ▼ session:delete 事件
┌─────────────────────────────────┐
│   SessionDeletionService        │
│   (执行业务删除逻辑)            │
│   BullMQ 队列（失败时自动重试） │
└─────────────────────────────────┘
    │
    ├─ 成功 → session:deleted 通知客户端
    │
    └─ 3次重试全失败 → Failed Event
              │
              ▼
    SessionDeletionFailedConsumer
       (等待30s后重新入队，无限重试)
```

## Deletion Scope

删除 session 时，清理以下数据：

| 存储       | 数据                               | 删除方式                                             |
| ---------- | ---------------------------------- | ---------------------------------------------------- |
| Redis      | `memory:short:${sessionId}`        | `ShortTermMemoryService.clear()`                     |
| PostgreSQL | `sessions` 表 row                  | `sessionRepository.delete()` (cascade 删除 messages) |
| Workspace  | `workspace/sessions/${sessionId}/` | `fs.rmSync()` 递归删除                               |

## Components

### 1. SessionDeletionService

**File:** `src/session/session-deletion.service.ts`

```typescript
@Injectable()
export class SessionDeletionService {
  async deleteSession(sessionId: string): Promise<void> {
    // Step 1: 删除 Redis
    await this.shortTermMemory.clear(sessionId);

    // Step 2: 删除 Workspace
    await this.workspaceService.deleteSessionDirectory(sessionId);

    // Step 3: 删除 DB (PostgreSQL - cascade 删除 messages)
    await this.db.transaction(async (manager) => {
      await manager.delete(SessionEntity, sessionId);
    });
  }
}
```

**删除顺序原则：** 先删"可恢复"的（Redis），最后删"难恢复"的（DB）。任何一步失败则整个操作失败，由 BullMQ 重试。

### 2. ChatGateway WebSocket Handler

**File:** `src/gateway/chat.gateway.ts`

**事件:** `session:delete`

```typescript
@SubscribeMessage('session:delete')
async handleSessionDelete(
  @ConnectedSocket() client: Socket,
  @MessageBody() data: { sessionId: string },
) {
  const { sessionId } = data;

  // 通知客户端删除开始
  this.server.to(`session:${sessionId}`).emit('session:delete:started', { sessionId });

  try {
    await this.deletionService.deleteSession(sessionId);

    // 通知客户端删除成功
    this.server.to(`session:${sessionId}`).emit('session:deleted', { sessionId });

    // 断开所有连接
    this.sessionManager.getSessionClients(sessionId).forEach(c => c.disconnect());

    return { success: true };
  } catch (error) {
    // 失败后入队列，等待后台重试
    await this.deletionQueue.add({ sessionId });

    this.server.to(`session:${sessionId}`).emit('session:delete:queued', {
      sessionId,
      message: 'Deletion queued for retry',
    });

    return { success: true, queued: true };
  }
}
```

### 3. BullMQ Queue

**File:** `src/queue/session-deletion.queue.ts`

```typescript
export const SESSION_DELETION_QUEUE = 'session-deletion';

@Injectable()
export class SessionDeletionQueue {
  constructor(private queue: Queue) {}

  async add(data: { sessionId: string }) {
    await this.queue.add('delete-session', data, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
      removeOnFail: false,
    });
  }
}
```

### 4. SessionDeletionQueueConsumer

**File:** `src/queue/session-deletion.processor.ts`

```typescript
@Processor(SESSION_DELETION_QUEUE)
export class SessionDeletionQueueConsumer {
  @Process()
  async handleDeletion(job: Job<{ sessionId: string }>) {
    const { sessionId } = job.data;
    await this.deletionService.deleteSession(sessionId);
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<{ sessionId: string }>) {
    const { sessionId } = job.data;
    this.logger.error(`Session ${sessionId} deletion failed after ${job.attemptsMade} attempts`);

    // 等待 30s 后重新入队，实现无限重试直到成功
    const delay = 30000;
    await this.deletionQueue.add({ sessionId }, { delay });

    // 通知客户端删除失败并等待重试
    this.server.to(`session:${sessionId}`).emit('session:delete:failed', {
      sessionId,
      attempt: job.attemptsMade,
      message: 'Deletion failed, retrying...',
    });
  }
}
```

## Deletion Flow

### Success Flow

```
1. Client sends session:delete { sessionId }
2. ChatGateway.handleSessionDelete()
3. SessionDeletionService.deleteSession()
   ├─ ShortTermMemory.clear(sessionId)  // Redis
   ├─ WorkspaceService.deleteSessionDirectory(sessionId)  // Workspace
   └─ sessionRepository.delete(sessionId)  // PostgreSQL (cascade messages)
4. ChatGateway emits session:deleted { sessionId }
5. Disconnect all clients in session
```

### Failure Flow (BullMQ Retry)

```
1. Client sends session:delete { sessionId }
2. ChatGateway.handleSessionDelete()
3. SessionDeletionService.deleteSession() throws
4. BullMQ 自动重试（3 attempts: 1s, 2s, 4s backoff）
5. 3 次全失败 → Job 进入 failed 状态
6. SessionDeletionQueueConsumer.onFailed() 捕获
7. 等待 30s 后重新入队
8. 重复步骤 4-7，直到删除成功
9. 最终成功后，删除 job 记录，通知客户端
```

**无限重试机制：** 每次 failed 后等待 30s 重新入队，确保最终成功。成功后才通知客户端 `session:deleted`。

## Notification Events

| Event                    | Payload                           | Trigger                       |
| ------------------------ | --------------------------------- | ----------------------------- |
| `session:delete:started` | `{ sessionId }`                   | 开始删除                      |
| `session:deleted`        | `{ sessionId }`                   | 删除成功（最终成功）          |
| `session:delete:queued`  | `{ sessionId, message }`          | 首次失败，已入队列            |
| `session:delete:failed`  | `{ sessionId, attempt, message }` | BullMQ 重试失败，等待下次重试 |

## Error Handling

**删除顺序：** Redis → Workspace → PostgreSQL

| 步骤          | 操作                    | 失败后果                 |
| ------------- | ----------------------- | ------------------------ |
| 1. Redis      | 删除缓存                | 可接受，TTL 也会自然过期 |
| 2. Workspace  | 删除文件目录            | 占磁盘空间，暂不处理     |
| 3. PostgreSQL | 删除 session + messages | 用户数据，必须成功       |

**任何一步失败都抛出异常，由 BullMQ 重试整个删除流程。**

**全失败（3次重试后）：**

- FailedConsumer 等待 30s 后重新入队
- 持续重试直到成功（无限重试）
- 日志记录每次失败信息

## Files to Create/Modify

### New Files

- `src/session/session-deletion.service.ts` - 业务删除逻辑
- `src/session/session-deletion.service.spec.ts` - 测试
- `src/queue/session-deletion.queue.ts` - BullMQ 队列定义
- `src/queue/session-deletion.processor.ts` - 队列消费者
- `src/queue/queue.module.ts` - Queue 模块定义

### Modify Files

- `src/gateway/chat.gateway.ts` - 添加 `session:delete` 事件处理
- `src/gateway/chat.gateway.spec.ts` - 更新测试
- `src/app.module.ts` - 导入 QueueModule
- `src/workspace/services/workspace.service.ts` - 添加 `deleteSessionDirectory()` 方法

## Testing

### Manual Testing Steps

1. 启动后端：`npm run start:dev`
2. 建立 WebSocket 连接，加入 session
3. 发送消息建立上下文
4. 发送删除请求：`socket.emit('session:delete', { sessionId: 'test-session' })`
5. 验证：
   - Redis key `memory:short:test-session` 已删除
   - Workspace 目录 `workspace/sessions/test-session/` 已删除
   - PostgreSQL `sessions` 和 `messages` 表中对应数据已删除
   - 收到 `session:deleted` 事件
   - 客户端断开连接

### Automated Tests

```bash
npm test
# 预期：所有测试通过
```

## Dependencies

```bash
npm install bullmq
npm install -D @types/bullmq
```
