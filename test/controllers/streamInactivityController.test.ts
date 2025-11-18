import { PassThrough } from 'node:stream';
import { resetInactivityTimer } from '../../src/controllers/streamInactivityController';
import { Stream } from '../../src/common/stream';
import { SILENT_AUDIO, INACTIVITY_TIMEOUT_MS } from '../../src/common/transcriptionMessage';
import { createTestWebSocket } from '../utils/mockWebSocket';
import { captureServerEvent } from '../../src/services/analytics/posthogClient';

jest.mock('../../src/services/analytics/posthogClient', () => ({
  captureServerEvent: jest.fn(),
}));

describe('streamInactivityController', () => {
  const captureEventMock = captureServerEvent as jest.Mock;

  beforeEach(() => {
    captureEventMock.mockClear();
  });

  const buildActiveStream = () => {
    const ws = createTestWebSocket();
    ws.streamID = 'stream-123';
    const stream = new Stream(ws);
    stream.isTranscribing = true;
    stream.audioStream = new PassThrough();
    jest.spyOn(stream.audioStream, 'write');
    return { ws, stream };
  };

  it('writes silent audio and emits analytics when inactivity threshold elapses', () => {
    jest.useFakeTimers();
    const { ws, stream } = buildActiveStream();

    resetInactivityTimer(ws, stream);
    jest.advanceTimersByTime(INACTIVITY_TIMEOUT_MS);

    expect(stream.audioStream?.write).toHaveBeenCalledWith(SILENT_AUDIO);
    expect(captureEventMock).toHaveBeenCalledWith(
      'stream_inactivity_detected',
      ws.streamID,
      expect.objectContaining({ streamID: ws.streamID })
    );
  });

  it('clears the previous timer when resetInactivityTimer is invoked again', () => {
    jest.useFakeTimers();
    const { ws, stream } = buildActiveStream();

    resetInactivityTimer(ws, stream);
    jest.advanceTimersByTime(INACTIVITY_TIMEOUT_MS / 2);

    resetInactivityTimer(ws, stream);
    jest.advanceTimersByTime(INACTIVITY_TIMEOUT_MS - 1);
    expect(stream.audioStream?.write).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(stream.audioStream?.write).toHaveBeenCalledTimes(1);
  });
});
