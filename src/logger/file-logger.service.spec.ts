import { promises as fs } from 'fs';
import { FileLogger } from './file-logger.service';

jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn(),
    readdir: jest.fn(),
    stat: jest.fn(),
    appendFile: jest.fn(),
    rename: jest.fn(),
  },
}));

describe('FileLogger', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fs.readdir as jest.Mock).mockResolvedValue([]);
  });

  it('should write service logs to disk', async () => {
    const logger = new FileLogger({
      logDir: './logs',
      fileName: 'service.log',
      fileEnabled: true,
      maxFileSizeBytes: 10 * 1024 * 1024,
      logLevels: [],
    });

    logger.log('hello logger', 'TestContext');
    await logger.flush();

    expect(fs.mkdir).toHaveBeenCalled();
    expect(fs.appendFile).toHaveBeenCalledWith(
      expect.stringContaining('service.log'),
      expect.stringContaining('hello logger'),
      'utf-8',
    );
  });

  it('should archive current log with timestamp when current file reaches 10MB', async () => {
    const logger = new FileLogger({
      logDir: './logs',
      fileName: 'service.log',
      fileEnabled: true,
      maxFileSizeBytes: 10 * 1024 * 1024,
      logLevels: [],
    });

    (fs.readdir as jest.Mock).mockResolvedValueOnce(['service.log']);
    (fs.stat as jest.Mock).mockResolvedValueOnce({
      size: 10 * 1024 * 1024,
      mtimeMs: Date.now(),
    });

    logger.warn('rotate this line', 'TestContext');
    await logger.flush();

    expect(fs.rename).toHaveBeenCalledWith(
      expect.stringContaining('service.log'),
      expect.stringMatching(/service\.\d{8}T\d{9}\.log$/),
    );
    expect(fs.appendFile).toHaveBeenCalledWith(expect.stringContaining('service.log'), expect.any(String), 'utf-8');
  });

  it('should skip file output when disabled', async () => {
    const logger = new FileLogger({
      logDir: './logs',
      fileName: 'service.log',
      fileEnabled: false,
      maxFileSizeBytes: 10 * 1024 * 1024,
      logLevels: [],
    });

    logger.log('disabled logger');
    await logger.flush();

    expect(fs.appendFile).not.toHaveBeenCalled();
  });
});
