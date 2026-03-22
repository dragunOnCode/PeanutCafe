# Session Deletion Design

> **Goal:** 实现 session 删除功能，删除 session 后该对话内所有消息都会被删除（包括 Redis 短期记忆、PostgreSQL 数据库、workspace 消息记录）。删除操作具有重试机制保证最终成功。

## Architecture Overview

```
ChatGateway (WebSocket)
    │
    ▼ session:delete 事件
┌─────────────────────────────────┐
│   SessionDeletionService        │
│   (执行业务删除逻辑 + 重试 3 次) │
└─────────────────────────────────┘
    │
    ├─ 成功 → session:deleted 通知客户端
    │
    └─ 失败（3次重试全失败）
              │
              ▼
       BullMQ Queue (session-deletion)
              │
              ▼
    SessionDeletionQueueConsumer
       (后台消费者处理失败任务)
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
interface DeleteSessionResult {
  success: boolean;
  sessionId: string;
  error?: string;
}

@Injectable()
export class SessionDeletionService {
  async deleteSession(sessionId: string): Promise<DeleteSessionResult> {
    // 删除 Redis
    await this.shortTermMemory.clear(sessionId);

    // 删除 Workspace
    await this.workspaceService.deleteSessionDirectory(sessionId);

    // 删除 DB (PostgreSQL - cascade 删除 messages)
    await this.db.transaction(async (manager) => {
      await manager.delete(SessionEntity, sessionId);
    });

    return { success: true, sessionId };
  }
}
```

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
    this.logger.error(`Session ${job.data.sessionId} deletion failed after ${job.attemptsMade} attempts`);

    // 记录失败日志，供人工排查
    this.logger.warn(`Job data: ${JSON.stringify(job.data)}`);
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

### Failure Flow (Retry)

```
1. Client sends session:delete { sessionId }
2. ChatGateway.handleSessionDelete()
3. SessionDeletionService.deleteSession() throws
4. BullMQ retries (3 attempts: 1s, 2s, 4s backoff)
5. All retries failed → Job enters failed state
6. ChatGateway emits session:delete:queued { sessionId }
7. SessionDeletionQueueConsumer (failed handler) logs error
```

### Queue Consumer Retry Flow

```
1. Failed job detected in SessionDeletionQueueConsumer
2. Re-add to queue with delay (future enhancement: exponential backoff)
3. Job re-processed by processor
4. Repeat until successful
```

## Notification Events

| Event                    | Payload                  | Trigger              |
| ------------------------ | ------------------------ | -------------------- |
| `session:delete:started` | `{ sessionId }`          | 开始删除             |
| `session:deleted`        | `{ sessionId }`          | 删除成功             |
| `session:delete:queued`  | `{ sessionId, message }` | 删除失败，已入队列   |
| `session:delete:failed`  | `{ sessionId, error }`   | 队列处理失败（可选） |

## Error Handling

1. **Redis 删除失败**: 记录日志，继续删除其他数据
2. **Workspace 删除失败**: 记录日志，继续删除其他数据
3. **PostgreSQL 删除失败**: 抛出异常，触发 BullMQ 重试
4. **全失败**: Job 进入 failed 状态，由消费者处理

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
