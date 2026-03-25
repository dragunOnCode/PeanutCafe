import { Test, TestingModule } from '@nestjs/testing';
import { PromptWatcherService } from './prompt-watcher.service';
import { PromptTemplateService } from './prompt-template.service';

describe('PromptWatcherService', () => {
  let service: PromptWatcherService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PromptWatcherService,
        { provide: PromptTemplateService, useValue: { clearSessionCache: jest.fn(), clearAllCache: jest.fn() } },
      ],
    }).compile();

    service = module.get<PromptWatcherService>(PromptWatcherService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should not throw when closing without watcher', () => {
    expect(() => service.onModuleDestroy()).not.toThrow();
  });
});
