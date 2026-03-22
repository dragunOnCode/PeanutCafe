# Session Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 session 删除功能，通过 BullMQ 队列实现删除操作的最终一致性保证。

**Architecture:** ChatGateway 接收 WebSocket 删除请求，SessionDeletionService 执行实际删除（Redis → Workspace → PostgreSQL），BullMQ 处理失败重试（3次 + 无限重试），FailedConsumer 处理最终失败场景。

**Tech Stack:** NestJS, BullMQ, TypeORM, ioredis, Socket.IO

---

## File Structure

```
src/
├── queue/
│   ├── queue.module.ts                       # 新建：BullMQ 模块
│   ├── session-deletion.queue.ts             # 新建：队列定义
│   └── session-deletion.processor.ts         # 新建：消费者处理器
├── session/
│   ├── session-deletion.service.ts          # 新建：删除业务逻辑
│   └── session-deletion.service.spec.ts     # 新建：测试
├── workspace/
│   └── services/
│       └── workspace.service.ts              # 修改：添加 deleteSessionDirectory
├── gateway/
│   ├── gateway.module.ts                    # 修改：导入 QueueModule
│   ├── chat.gateway.ts                      # 修改：添加 session:delete 事件
│   └── chat.gateway.spec.ts                 # 修改：添加删除功能测试
└── app.module.ts                            # 修改：导入 QueueModule
```

---

## Task 1: 安装 BullMQ 依赖

- Modify: `package.json`

- [ ] **Step 1: 安装 BullMQ**

```bash
npm install bullmq
npm install -D @types/bullmq
```

- [ ] **Step 2: 提交**

```bash
git add package.json package-lock.json
git commit -m "deps: add bullmq for session deletion queue"
```

---

## Task 2: 创建 Queue 模块

**Files:**

- Create: `src/queue/queue.module.ts`
- Create: `src/queue/session-deletion.queue.ts`
- Create: `src/queue/session-deletion.processor.ts`

- [ ] **Step 1: 创建 queue.module.ts**

```typescript
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SessionDeletionQueue } from './session-deletion.queue';
import { SessionDeletionProcessor } from './session-deletion.processor';

@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        password: process.env.REDIS_PASSWORD || undefined,
      },
    }),
    BullModule.registerQueue({
      name: 'session-deletion',
    }),
  ],
  providers: [SessionDeletionQueue, SessionDeletionProcessor],
  exports: [SessionDeletionQueue],
})
export class QueueModule {}
```

- [ ] **Step 2: 创建 session-deletion.queue.ts**

```typescript
import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export const SESSION_DELETION_QUEUE = 'session-deletion';

@Injectable()
export class SessionDeletionQueue {
  constructor(@InjectQueue(SESSION_DELETION_QUEUE) private queue: Queue) {}

  async add(sessionId: string) {
    await this.queue.add(
      'delete-session',
      { sessionId },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnFail: false,
      },
    );
  }
}
```

- [ ] **Step 3: 创建 session-deletion.processor.ts**

```typescript
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger, Injectable } from '@nestjs/common';
import { Job } from 'bullmq';
import { Server } from 'socket.io';
import { SESSION_DELETION_QUEUE } from './session-deletion.queue';
import { SessionDeletionQueue } from './session-deletion.queue';
import { SessionDeletionService } from '../session/session-deletion.service';

const MAX_RETRY_BEFORE_STUCK = 10;

@Injectable()
@Processor(SESSION_DELETION_QUEUE)
export class SessionDeletionProcessor extends WorkerHost {
  private readonly logger = new Logger(SessionDeletionProcessor.name);

  constructor(
    private readonly deletionService: SessionDeletionService,
    private readonly deletionQueue: SessionDeletionQueue,
    private readonly server: Server,
  ) {
    super();
  }

  async process(job: Job<{ sessionId: string }>): Promise<void> {
    const { sessionId } = job.data;
    this.logger.log(`Processing session deletion: ${sessionId}`);
    await this.deletionService.deleteSession(sessionId);
  }

  @OnWorkerEvent('completed')
  async onCompleted(job: Job<{ sessionId: string }>) {
    const { sessionId } = job.data;
    this.logger.log(`Session ${sessionId} deleted successfully`);
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<{ sessionId: string }>) {
    const { sessionId } = job.data;
    const attempts = job.attemptsMade ?? 1;

    this.logger.error(`Session ${sessionId} deletion failed after ${attempts} attempts`);

    if (attempts >= MAX_RETRY_BEFORE_STUCK) {
      this.server.to(`session:${sessionId}`).emit('session:delete:stuck', {
        sessionId,
        attempts,
        message: 'Deletion persistently failing, please contact support',
      });
      this.logger.error(`Session ${sessionId} deletion stuck after ${attempts} attempts`);
      return;
    }

    this.server.to(`session:${sessionId}`).emit('session:delete:failed', {
      sessionId,
      attempt: attempts,
      message: 'Deletion failed, retrying...',
    });

    const delay = 30000;
    await this.deletionQueue.add(sessionId);
    this.logger.log(`Session ${sessionId} re-queued with ${delay}ms delay`);
  }
}
```

- [ ] **Step 4: 提交**

```bash
git add src/queue/
git commit -m "feat(queue): add BullMQ session deletion queue"
```

---

## Task 3: 创建 SessionDeletionService

**Files:**

- Create: `src/session/session-deletion.service.ts`
- Create: `src/session/session-deletion.service.spec.ts`

- [ ] **Step 1: 创建 session-deletion.service.ts**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ShortTermMemoryService } from '../memory/services/short-term-memory.service';
import { WorkspaceService } from '../workspace/services/workspace.service';
import { SessionEntity } from '../database/entities/session.entity';

@Injectable()
export class SessionDeletionService {
  private readonly logger = new Logger(SessionDeletionService.name);

  constructor(
    @InjectRepository(SessionEntity)
    private readonly sessionRepository: Repository<SessionEntity>,
    private readonly shortTermMemory: ShortTermMemoryService,
    private readonly workspaceService: WorkspaceService,
    private readonly dataSource: DataSource,
  ) {}

  async deleteSession(sessionId: string): Promise<void> {
    this.logger.log(`Deleting session: ${sessionId}`);

    await this.shortTermMemory.clear(sessionId);
    await this.workspaceService.deleteSessionDirectory(sessionId);

    await this.dataSource.transaction(async (manager) => {
      await manager.delete(SessionEntity, sessionId);
    });

    this.logger.log(`Session ${sessionId} deleted successfully`);
  }
}
```

- [ ] **Step 2: 创建 session-deletion.service.spec.ts**

```typescript
import { SessionDeletionService } from './session-deletion.service';
import { ShortTermMemoryService } from '../memory/services/short-term-memory.service';
import { WorkspaceService } from '../workspace/services/workspace.service';

describe('SessionDeletionService', () => {
  let service: SessionDeletionService;
  let shortTermMemory: jest.Mocked<ShortTermMemoryService>;
  let workspaceService: jest.Mocked<WorkspaceService>;
  let dataSource: { transaction: jest.Mock };

  beforeEach(() => {
    shortTermMemory = {
      clear: jest.fn().mockResolvedValue(undefined),
    } as any;

    workspaceService = {
      deleteSessionDirectory: jest.fn().mockResolvedValue(undefined),
    } as any;

    dataSource = {
      transaction: jest.fn(async (fn) => fn({ delete: jest.fn().mockResolvedValue(undefined) })),
    };

    service = new SessionDeletionService({} as any, shortTermMemory, workspaceService, dataSource);
  });

  describe('deleteSession', () => {
    it('should delete from all storage layers in order', async () => {
      await service.deleteSession('test-session');

      expect(shortTermMemory.clear).toHaveBeenCalledWith('test-session');
      expect(workspaceService.deleteSessionDirectory).toHaveBeenCalledWith('test-session');
      expect(dataSource.transaction).toHaveBeenCalled();
    });

    it('should throw if Redis deletion fails', async () => {
      shortTermMemory.clear.mockRejectedValue(new Error('Redis error'));

      await expect(service.deleteSession('test-session')).rejects.toThrow('Redis error');
      expect(workspaceService.deleteSessionDirectory).not.toHaveBeenCalled();
    });

    it('should throw if Workspace deletion fails', async () => {
      workspaceService.deleteSessionDirectory.mockRejectedValue(new Error('FS error'));

      await expect(service.deleteSession('test-session')).rejects.toThrow('FS error');
    });
  });
});
```

- [ ] **Step 3: 运行测试**

```bash
npm test -- --testPathPatterns="session-deletion.service.spec.ts"
```

- [ ] **Step 4: 提交**

```bash
git add src/session/
git commit -m "feat(session): add SessionDeletionService"
```

---

## Task 4: 添加 WorkspaceService.deleteSessionDirectory

**Files:**

- Modify: `src/workspace/services/workspace.service.ts`

- [ ] **Step 1: 添加 deleteSessionDirectory 方法**

在 `WorkspaceService` 中添加：

```typescript
async deleteSessionDirectory(sessionId: string): Promise<void> {
  const dir = join(this.baseDir, sessionId);
  await fs.rm(dir, { recursive: true, force: true });
}
```

- [ ] **Step 2: 提交**

```bash
git add src/workspace/services/workspace.service.ts
git commit -m "feat(workspace): add deleteSessionDirectory method"
```

---

## Task 5: 更新 ChatGateway

**Files:**

- Modify: `src/gateway/chat.gateway.ts`
- Modify: `src/gateway/chat.gateway.spec.ts`

- [ ] **Step 1: 添加 SessionDeletionQueue 依赖注入**

在 constructor 中添加：

```typescript
import { SessionDeletionQueue } from '../queue/session-deletion.queue';
import { SessionDeletionService } from '../session/session-deletion.service';

constructor(
  // ... existing deps
  private readonly deletionService: SessionDeletionService,
  private readonly deletionQueue: SessionDeletionQueue,
) {}
```

- [ ] **Step 2: 添加 session:delete 事件处理**

```typescript
@SubscribeMessage('session:delete')
async handleSessionDelete(
  @ConnectedSocket() client: Socket,
  @MessageBody() data: { sessionId: string },
) {
  const { sessionId } = data;

  this.server.to(`session:${sessionId}`).emit('session:delete:started', { sessionId });

  try {
    await this.deletionService.deleteSession(sessionId);

    this.server.to(`session:${sessionId}`).emit('session:deleted', { sessionId });
    this.sessionManager.getSessionClients(sessionId).forEach(c => c.disconnect());

    return { success: true };
  } catch (error) {
    await this.deletionQueue.add(sessionId);

    this.server.to(`session:${sessionId}`).emit('session:delete:queued', {
      sessionId,
      message: 'Deletion queued for retry',
    });

    return { success: true, queued: true };
  }
}
```

- [ ] **Step 3: 更新 ChatGateway 测试**

在 `chat.gateway.spec.ts` 的 beforeEach 中添加 mock：

```typescript
let deletionService: { deleteSession: jest.Mock };
let deletionQueue: { add: jest.Mock };

beforeEach(() => {
  // ... existing mocks

  deletionService = {
    deleteSession: jest.fn().mockResolvedValue(undefined),
  };
  deletionQueue = {
    add: jest.fn().mockResolvedValue(undefined),
  };

  gateway = new ChatGateway(
    // ... existing args
    deletionService as never,
    deletionQueue as never,
  );
});
```

添加测试用例：

```typescript
it('emits session:deleted and disconnects clients on successful deletion', async () => {
  const sessionId = 'test-session';

  await gateway.handleSessionDelete(client as any, { sessionId });

  expect(deletionService.deleteSession).toHaveBeenCalledWith(sessionId);
  expect(serverEmit).toHaveBeenCalledWith('session:delete:started', { sessionId });
  expect(serverEmit).toHaveBeenCalledWith('session:deleted', { sessionId });
});

it('queues deletion on failure', async () => {
  const sessionId = 'test-session';
  deletionService.deleteSession.mockRejectedValue(new Error('DB error'));

  const result = await gateway.handleSessionDelete(client as any, { sessionId });

  expect(result).toEqual({ success: true, queued: true });
  expect(deletionQueue.add).toHaveBeenCalledWith(sessionId);
  expect(serverEmit).toHaveBeenCalledWith('session:delete:queued', { sessionId, message: 'Deletion queued for retry' });
});
```

- [ ] **Step 4: 运行测试**

```bash
npm test -- --testPathPatterns="chat.gateway.spec.ts"
```

- [ ] **Step 5: 提交**

```bash
git add src/gateway/chat.gateway.ts src/gateway/chat.gateway.spec.ts
git commit -m "feat(gateway): add session:delete event handling"
```

---

## Task 6: 更新 GatewayModule

**Files:**

- Modify: `src/gateway/gateway.module.ts`

- [ ] **Step 1: 导入 QueueModule 和 SessionDeletionService**

```typescript
import { QueueModule } from '../queue/queue.module';
import { SessionDeletionService } from '../session/session-deletion.service';

@Module({
  imports: [AgentsModule, MemoryModule, WorkspaceModule, DatabaseModule, QueueModule],
  providers: [ChatGateway, SessionManager, MessageRouter, AgentRouter, SessionDeletionService],
  exports: [ChatGateway, AgentRouter],
})
export class GatewayModule {}
```

- [ ] **Step 2: 提交**

```bash
git add src/gateway/gateway.module.ts
git commit -m "feat(gateway): import QueueModule and SessionDeletionService"
```

---

## Task 7: 更新 AppModule

**Files:**

- Modify: `src/app.module.ts`

- [ ] **Step 1: 导入 QueueModule**

```typescript
import { QueueModule } from './queue/queue.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    AgentsModule,
    MemoryModule,
    WorkspaceModule,
    GatewayModule,
    QueueModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 2: 提交**

```bash
git add src/app.module.ts
git commit -m "feat: import QueueModule in AppModule"
```

---

## Task 8: 最终测试

- [ ] **Step 1: 运行完整测试**

```bash
npm test
```

- [ ] **Step 2: 提交所有剩余更改**

```bash
git status
git add -A
git commit -m "feat: implement session deletion with BullMQ retry"
```

---

## 验收测试

### 手动测试步骤

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

### 失败重试测试

1. 模拟删除失败（断开 Redis/故意报错）
2. 发送删除请求
3. 验证 `session:delete:queued` 事件
4. 验证 BullMQ 重试（查看日志）
5. 最终成功/失败通知
