import { ConsoleLogger, LogLevel } from '@nestjs/common';
import { promises as fs } from 'fs';
import { basename, extname, join, resolve } from 'path';

export interface FileLoggerOptions {
  logDir: string;
  fileName?: string;
  maxFileSizeBytes?: number;
  fileEnabled?: boolean;
  logLevels?: LogLevel[];
}

type SupportedLogLevel = LogLevel | 'fatal';

export class FileLogger extends ConsoleLogger {
  private readonly logDir: string;
  private readonly fileName: string;
  private readonly fileStem: string;
  private readonly fileExt: string;
  private readonly maxFileSizeBytes: number;
  private readonly fileEnabled: boolean;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(options: FileLoggerOptions) {
    super('Application', { timestamp: true, logLevels: options.logLevels });
    this.logDir = resolve(options.logDir);
    this.fileName = options.fileName ?? 'service.log';
    this.fileExt = extname(this.fileName) || '.log';
    this.fileStem = basename(this.fileName, this.fileExt);
    this.maxFileSizeBytes = options.maxFileSizeBytes ?? 10 * 1024 * 1024;
    this.fileEnabled = options.fileEnabled ?? true;
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    super.log(message, ...optionalParams);
    this.enqueueWrite('log', message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    super.error(message, ...optionalParams);
    this.enqueueWrite('error', message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    super.warn(message, ...optionalParams);
    this.enqueueWrite('warn', message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    super.debug(message, ...optionalParams);
    this.enqueueWrite('debug', message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    super.verbose(message, ...optionalParams);
    this.enqueueWrite('verbose', message, optionalParams);
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    super.fatal(message, ...optionalParams);
    this.enqueueWrite('fatal', message, optionalParams);
  }

  async flush(): Promise<void> {
    await this.writeQueue;
  }

  private enqueueWrite(level: SupportedLogLevel, message: unknown, optionalParams: unknown[]): void {
    if (!this.fileEnabled) {
      return;
    }

    this.writeQueue = this.writeQueue
      .then(() => this.writeLine(level, message, optionalParams))
      .catch((error: unknown) => {
        super.error(`Failed to write log file: ${this.stringifyValue(error)}`, undefined, FileLogger.name);
      });
  }

  private async writeLine(level: SupportedLogLevel, message: unknown, optionalParams: unknown[]): Promise<void> {
    await fs.mkdir(this.logDir, { recursive: true });
    const line = this.formatLine(level, message, optionalParams);
    const writablePath = await this.prepareWritableFile(line);
    await fs.appendFile(writablePath, line, 'utf-8');
  }

  private formatLine(level: SupportedLogLevel, message: unknown, optionalParams: unknown[]): string {
    const timestamp = new Date().toISOString();
    const context = this.extractContext(optionalParams);
    const trace = this.extractTrace(optionalParams);
    const metadata = this.extractMetadata(optionalParams, trace !== undefined);
    const metadataPart = metadata.length > 0 ? ` ${metadata.map((item) => this.stringifyValue(item)).join(' ')}` : '';
    const tracePart = trace ? `\n${trace}` : '';
    const contextPart = context ? ` [${context}]` : '';
    return `${timestamp} ${level.toUpperCase()}${contextPart} ${this.stringifyValue(message)}${metadataPart}${tracePart}\n`;
  }

  private extractContext(optionalParams: unknown[]): string | undefined {
    if (optionalParams.length === 0) {
      return undefined;
    }

    const last = optionalParams[optionalParams.length - 1];
    return typeof last === 'string' ? last : undefined;
  }

  private extractTrace(optionalParams: unknown[]): string | undefined {
    if (optionalParams.length < 2) {
      return undefined;
    }

    return typeof optionalParams[0] === 'string' && typeof optionalParams[1] === 'string'
      ? optionalParams[0]
      : undefined;
  }

  private extractMetadata(optionalParams: unknown[], hasTrace: boolean): unknown[] {
    if (optionalParams.length === 0) {
      return [];
    }

    const context = this.extractContext(optionalParams);
    const until = context ? optionalParams.length - 1 : optionalParams.length;
    if (hasTrace && until > 0) {
      return optionalParams.slice(1, until);
    }
    return optionalParams.slice(0, until);
  }

  private stringifyValue(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }

    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  private async prepareWritableFile(line: string): Promise<string> {
    const currentPath = join(this.logDir, this.fileName);

    try {
      const stat = await fs.stat(currentPath);
      const incomingSize = Buffer.byteLength(line, 'utf-8');
      if (stat.size + incomingSize > this.maxFileSizeBytes) {
        const archivedPath = join(this.logDir, this.getArchiveFileName(new Date()));
        await fs.rename(currentPath, archivedPath);
      }
      return currentPath;
    } catch {
      return currentPath;
    }
  }

  private getArchiveFileName(timestamp: Date): string {
    const year = timestamp.getFullYear();
    const month = String(timestamp.getMonth() + 1).padStart(2, '0');
    const day = String(timestamp.getDate()).padStart(2, '0');
    const hours = String(timestamp.getHours()).padStart(2, '0');
    const minutes = String(timestamp.getMinutes()).padStart(2, '0');
    const seconds = String(timestamp.getSeconds()).padStart(2, '0');
    const milliseconds = String(timestamp.getMilliseconds()).padStart(3, '0');
    return `${this.fileStem}.${year}${month}${day}T${hours}${minutes}${seconds}${milliseconds}${this.fileExt}`;
  }
}
