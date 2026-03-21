import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { LogLevel } from '@nestjs/common';
import { AppModule } from './app.module';
import { FileLogger } from './logger/file-logger.service';

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function resolveLogLevels(level: string | undefined): LogLevel[] {
  const normalized = (level ?? 'log').toLowerCase();
  const priority: LogLevel[] = ['error', 'warn', 'log', 'debug', 'verbose'];

  if (normalized === 'fatal') {
    return ['fatal'];
  }

  const index = priority.indexOf(normalized as LogLevel);
  if (index === -1) {
    return ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'];
  }

  const levels = priority.slice(0, index + 1);
  return [...levels, 'fatal'];
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const configService = app.get(ConfigService);
  const logger = new FileLogger({
    logDir: configService.get<string>('LOG_FILE_PATH') ?? './logs',
    fileName: 'service.log',
    maxFileSizeBytes: 10 * 1024 * 1024,
    fileEnabled: parseBoolean(configService.get<string>('LOG_FILE_ENABLED'), true),
    logLevels: resolveLogLevels(configService.get<string>('LOG_LEVEL')),
  });
  app.useLogger(logger);
  const port = configService.getOrThrow<number>('PORT') || 3000;
  await app.listen(port);
}
void bootstrap();
