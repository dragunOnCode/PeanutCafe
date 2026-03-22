import { McpClientImpl } from './mcp-client';
import { Readable, Writable } from 'stream';

describe('McpClientImpl', () => {
  let mockStdin: Writable;
  let mockStdout: Readable;

  beforeEach(() => {
    mockStdout = new Readable({
      read() {
        this.push('{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}\n');
      },
    });
    mockStdin = new Writable({
      write(chunk, encoding, callback) {
        callback();
      },
    });
  });

  it('should create client with streams', () => {
    const client = new McpClientImpl(mockStdout, mockStdin);
    expect(client).toBeDefined();
  });

  it('should report not connected initially', () => {
    const client = new McpClientImpl(mockStdout, mockStdin);
    expect(client.isConnected()).toBe(false);
  });
});
