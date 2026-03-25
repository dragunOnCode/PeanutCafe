import { Module, Global } from '@nestjs/common';
import { PromptTemplateService } from './prompt-template.service';
import { PromptBuilder } from './prompt-builder';
import { PromptWatcherService } from './prompt-watcher.service';

@Global()
@Module({
  providers: [PromptTemplateService, PromptBuilder, PromptWatcherService],
  exports: [PromptTemplateService, PromptBuilder],
})
export class PromptsModule {}
