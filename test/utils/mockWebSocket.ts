import { EventEmitter } from 'events';
import WebSocket from 'ws';
import type { CustomWebSocket } from '../../src/common/customWebSocket';

export type TestWebSocket = CustomWebSocket & {
  sendMock: jest.Mock;
  closeMock: jest.Mock;
};

export const createTestWebSocket = (): TestWebSocket => {
  const emitter = new EventEmitter();
  const ws = emitter as unknown as TestWebSocket;

  ws.sendMock = jest.fn();
  ws.closeMock = jest.fn();
  Object.defineProperty(ws, 'readyState', {
    value: WebSocket.OPEN,
    writable: true,
  });

  ws.send = ws.sendMock as unknown as TestWebSocket['send'];
  ws.close = ws.closeMock as unknown as TestWebSocket['close'];

  return ws;
};
