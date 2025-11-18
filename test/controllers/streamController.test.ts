import { PassThrough } from 'node:stream';
import * as streamController from '../../src/controllers/streamController';
import { streams, Stream } from '../../src/common/stream';
import { createTestWebSocket, TestWebSocket } from '../utils/mockWebSocket';
import { TargetLangCode } from '../../src/common/supportedLanguageCodes';
import { captureServerEvent, captureServerError } from '../../src/services/analytics/posthogClient';
import { startTranscription } from '../../src/controllers/transcriptionController';
import { v4 as uuidv4 } from 'uuid';

const { handleWebSocketConnection, initializeNewAudioStream } = streamController;

jest.mock('../../src/services/analytics/posthogClient', () => ({
  captureServerEvent: jest.fn(),
  captureServerError: jest.fn(),
  identifyStream: jest.fn(),
}));

jest.mock('../../src/controllers/transcriptionController', () => ({
  startTranscription: jest.fn(),
}));

jest.mock('uuid', () => ({
  v4: jest.fn(),
}));

describe('streamController', () => {
  const mockedUuid = uuidv4 as jest.Mock;
  const mockedStartTranscription = startTranscription as jest.MockedFunction<typeof startTranscription>;
  const captureEventMock = captureServerEvent as jest.MockedFunction<typeof captureServerEvent>;
  const captureErrorMock = captureServerError as jest.MockedFunction<typeof captureServerError>;

  beforeEach(() => {
    streams.clear();
    mockedUuid.mockReset();
    mockedStartTranscription.mockReset();
    captureEventMock.mockClear();
    captureErrorMock.mockClear();
  });

  const emitInitialMessage = (ws: TestWebSocket, payload: unknown) => {
    const buffer = Buffer.isBuffer(payload) ? payload : Buffer.from(JSON.stringify(payload));
    ws.emit('message', buffer, false);
  };

  const emitControlMessage = (ws: TestWebSocket, payload: unknown) => {
    ws.emit('message', Buffer.from(JSON.stringify(payload)), false);
  };

  it('closes the socket and captures an error when the initial payload is invalid JSON', () => {
    const ws = createTestWebSocket();
    mockedUuid.mockReturnValueOnce('analytics-id');
    handleWebSocketConnection(ws);

    ws.emit('message', Buffer.from('not json'), false);

    expect(ws.closeMock).toHaveBeenCalledTimes(1);
    expect(captureErrorMock).toHaveBeenCalledWith(
      'ws_invalid_json',
      expect.any(Error),
      'analytics-id',
      expect.objectContaining({ rawMessage: 'not json' })
    );
  });

  it('starts a new stream when it receives a start message', () => {
    const ws = createTestWebSocket();
    mockedUuid.mockReturnValueOnce('analytics-id').mockReturnValueOnce('new-stream-id');
    handleWebSocketConnection(ws);

    emitInitialMessage(ws, { type: 'start', language: 'ru-RU' as TargetLangCode });

    expect(ws.streamID).toBe('new-stream-id');
    expect(ws.isAudioSource).toBe(true);
    expect(ws.initialized).toBe(true);
    expect(streams.has('new-stream-id')).toBe(true);
    expect(ws.sendMock).toHaveBeenCalledWith(
      JSON.stringify({ type: 'streamID', streamID: 'new-stream-id' })
    );
    expect(mockedStartTranscription).toHaveBeenCalledWith(ws, 'new-stream-id', 'ru-RU');
  });

  it('handles stop control messages by aborting transcription', () => {
    const ws = createTestWebSocket();
    const abortMock = jest.fn();
    mockedUuid.mockReturnValueOnce('analytics-id').mockReturnValueOnce('stream-id');
    handleWebSocketConnection(ws);
    emitInitialMessage(ws, { type: 'start' });

    const stream = streams.get('stream-id');
    expect(stream).toBeDefined();
    stream!.abortController = { abort: abortMock } as unknown as AbortController;

    emitControlMessage(ws, { type: 'stop' });

    expect(stream!.isTranscribing).toBe(false);
    expect(stream!.abortController).toBeNull();
    expect(abortMock).toHaveBeenCalledTimes(1);
    expect(captureEventMock).toHaveBeenCalledWith(
      'control_stop_received',
      expect.any(String),
      expect.objectContaining({ streamID: 'stream-id' })
    );
  });

  it('pauses and restarts transcription via control messages', () => {
    const ws = createTestWebSocket();
    mockedUuid.mockReturnValueOnce('analytics-id').mockReturnValueOnce('stream-id');
    const initializeSpy = jest.spyOn(streamController, 'initializeNewAudioStream');
    handleWebSocketConnection(ws);
    emitInitialMessage(ws, { type: 'start', language: 'en-US' });

    const stream = streams.get('stream-id');
    expect(stream).toBeDefined();

    emitControlMessage(ws, { type: 'pause' });
    expect(stream!.isTranscribing).toBe(false);
    expect(captureEventMock).toHaveBeenCalledWith(
      'control_pause_received',
      expect.any(String),
      expect.objectContaining({ streamID: 'stream-id' })
    );

    initializeSpy.mockClear();
    emitControlMessage(ws, { type: 'start', language: 'cs-CZ' });
    expect(stream!.isTranscribing).toBe(true);
    expect(initializeSpy).toHaveBeenCalledTimes(1);
    expect(mockedStartTranscription).toHaveBeenLastCalledWith(ws, 'stream-id', 'cs-CZ');
  });

  it('restarts the stream with a new language when receiving change_language', () => {
    const ws = createTestWebSocket();
    mockedUuid
      .mockReturnValueOnce('analytics-id')
      .mockReturnValueOnce('stream-id')
      .mockReturnValueOnce('new-stream-id');
    handleWebSocketConnection(ws);
    emitInitialMessage(ws, { type: 'start', language: 'en-US' });

    emitControlMessage(ws, { type: 'change_language', language: 'lv-LV' as TargetLangCode });

    expect(ws.streamID).toBe('new-stream-id');
    expect(streams.has('new-stream-id')).toBe(true);
    expect(mockedStartTranscription).toHaveBeenLastCalledWith(ws, 'new-stream-id', 'lv-LV');
    expect(captureEventMock).toHaveBeenCalledWith(
      'language_change_requested',
      expect.any(String),
      expect.objectContaining({ newLanguage: 'lv-LV' })
    );
  });

  it('subscribes to an existing stream when receiving a subscribe message', () => {
    const audioSource = createTestWebSocket();
    audioSource.streamID = 'existing-stream';
    const stream = new Stream(audioSource as unknown as TestWebSocket);
    streams.set('existing-stream', stream);

    const ws = createTestWebSocket();
    mockedUuid.mockReturnValueOnce('analytics-id');
    handleWebSocketConnection(ws);

    emitInitialMessage(ws, { type: 'subscribe', streamID: 'existing-stream' });

    expect(ws.isAudioSource).toBe(false);
    expect(ws.initialized).toBe(true);
    expect(stream.subscribers.has(ws)).toBe(true);
    expect(captureEventMock).toHaveBeenCalledWith(
      'subscriber_join_success',
      expect.any(String),
      expect.objectContaining({
        streamID: 'existing-stream',
        subscriberCount: 1,
      })
    );
  });

  it('initializes a fresh PassThrough and destroys the old one when initializeNewAudioStream is called', () => {
    const audioSource = createTestWebSocket();
    audioSource.streamID = 'audio-source-id';
    const stream = new Stream(audioSource);
    const originalStream = new PassThrough();
    const destroySpy = jest.spyOn(originalStream, 'destroy');
    stream.audioStream = originalStream;

    initializeNewAudioStream(stream);

    expect(destroySpy).toHaveBeenCalledTimes(1);
    expect(stream.audioStream).toBeInstanceOf(PassThrough);
    expect(stream.audioStream).not.toBe(originalStream);
    expect(captureEventMock).toHaveBeenCalledWith(
      'audio_stream_initialized',
      audioSource.streamID,
      expect.objectContaining({ streamID: audioSource.streamID })
    );
  });
});
