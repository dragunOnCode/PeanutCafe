import { CotWriterService } from './cot-writer.service';

describe('CotWriterService', () => {
  let cotWriter: CotWriterService;

  beforeEach(() => {
    cotWriter = new CotWriterService();
  });

  it('should be instantiable', () => {
    expect(cotWriter).toBeInstanceOf(CotWriterService);
  });

  it('should have writeAgentThinking method', () => {
    expect(typeof cotWriter.writeAgentThinking).toBe('function');
  });
});
