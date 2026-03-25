import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import * as chokidar from 'chokidar';
import * as path from 'path';
import { PromptTemplateService } from './prompt-template.service';

@Injectable()
export class PromptWatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PromptWatcherService.name);
  private watcher: chokidar.FSWatcher | undefined;

  constructor(private readonly templateService: PromptTemplateService) {}

  onModuleInit(): void {
    this.startWatching();
  }

  onModuleDestroy(): void {
    this.closeWatcher();
  }

  startWatching(): void {
    if (process.env.NODE_ENV !== 'development') {
      this.logger.log('PromptWatcher skipped in production mode');
      return;
    }

    const watchPath = path.join(process.cwd(), 'config', 'prompts', '**', '*.md');

    this.watcher = chokidar.watch(watchPath, {
      persistent: true,
      ignoreInitial: true,
    });

    this.watcher.on('change', (filePath) => {
      this.logger.log(`Prompt file changed: ${filePath}`);
      this.templateService.clearAllCache();
    });

    this.watcher.on('add', (filePath) => {
      this.logger.log(`Prompt file added: ${filePath}`);
    });

    this.logger.log('PromptWatcher started in development mode');
  }

  private closeWatcher(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = undefined;
      this.logger.log('PromptWatcher closed');
    }
  }
}
