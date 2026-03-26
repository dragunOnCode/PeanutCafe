// src/orchestration/workflow.controller.ts
// WorkflowController - 人工审核决策 API
// 提供 Human-in-the-loop 的审核接口，前端通过这些 API 决策后续操作

import { Controller, Post, Param, Body, HttpCode, Logger } from '@nestjs/common';
import { OrchestrationService } from './orchestration.service';

@Controller('workflow')
export class WorkflowController {
  private readonly logger = new Logger(WorkflowController.name);

  constructor(private readonly orchestrationService: OrchestrationService) {}

  /**
   * 批准审核 - 用户批准当前任务，继续执行
   * POST /workflow/:sessionId/review/approve
   */
  @Post(':sessionId/review/approve')
  @HttpCode(200)
  approveReview(@Param('sessionId') sessionId: string) {
    this.logger.log(`[WorkflowController] Review approved: sessionId=${sessionId}`);
    // TODO: 实现批准逻辑，更新工作流状态
    return { success: true, action: 'approved', sessionId };
  }

  /**
   * 拒绝审核 - 用户拒绝当前任务，终止工作流
   * POST /workflow/:sessionId/review/reject
   */
  @Post(':sessionId/review/reject')
  @HttpCode(200)
  rejectReview(@Param('sessionId') sessionId: string, @Body() dto: { reason?: string }) {
    this.logger.log(`[WorkflowController] Review rejected: sessionId=${sessionId}, reason=${dto.reason}`);
    // TODO: 实现拒绝逻辑，终止工作流
    return { success: true, action: 'rejected', sessionId, reason: dto.reason };
  }

  /**
   * 重试任务 - 用户选择重试失败的任务
   * POST /workflow/:sessionId/error/retry
   */
  @Post(':sessionId/error/retry')
  @HttpCode(200)
  retryTask(@Param('sessionId') sessionId: string) {
    this.logger.log(`[WorkflowController] Retry requested: sessionId=${sessionId}`);
    // TODO: 实现重试逻辑，重新执行失败的任务
    return { success: true, action: 'retry', sessionId };
  }

  /**
   * 跳过任务 - 用户选择跳过失败的任务，继续下一个
   * POST /workflow/:sessionId/error/skip
   */
  @Post(':sessionId/error/skip')
  @HttpCode(200)
  skipTask(@Param('sessionId') sessionId: string) {
    this.logger.log(`[WorkflowController] Skip requested: sessionId=${sessionId}`);
    // TODO: 实现跳过逻辑，继续下一个任务
    return { success: true, action: 'skipped', sessionId };
  }
}
