import { Controller, Post, Body } from '@nestjs/common';
import { PromptTemplateService } from './prompt-template.service';

@Controller('admin/prompts')
export class PromptsController {
  constructor(private readonly templateService: PromptTemplateService) {}

  @Post('cache/refresh')
  refreshCache(@Body() dto: { sessionId?: string }): { cleared: number } {
    if (dto.sessionId) {
      this.templateService.clearSessionCache(dto.sessionId);
      return { cleared: 1 };
    } else {
      this.templateService.clearAllCache();
      return { cleared: -1 };
    }
  }
}
