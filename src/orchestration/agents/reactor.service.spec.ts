import { ReactorService } from './reactor.service';

describe('ReactorService', () => {
  let reactor: ReactorService;
  let mockAdapter: jest.Mocked<any>;

  beforeEach(() => {
    mockAdapter = {
      generate: jest.fn().mockResolvedValue({ content: '思考内容' }),
    };
    reactor = new ReactorService(mockAdapter);
  });

  it('should be instantiable', () => {
    expect(reactor).toBeInstanceOf(ReactorService);
  });

  it('should have execute method', () => {
    expect(typeof reactor.execute).toBe('function');
  });
});
