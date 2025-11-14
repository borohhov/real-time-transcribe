// src/controllers/streamController.ts
import { CustomWebSocket } from '../common/customWebSocket';
import { v4 as uuidv4 } from 'uuid';
import { startTranscription } from './transcriptionController';
import { Stream, streams } from '../common/stream';
import { PassThrough } from 'node:stream';
import { TargetLangCode } from '../common/supportedLanguageCodes';
import { resetInactivityTimer } from './streamInactivityController';
import { captureServerEvent, captureServerError, identifyStream } from '../services/analytics/posthogClient';

const getDistinctId = (ws?: CustomWebSocket) => ws?.streamID || ws?.analyticsId || 'server';

const emitEvent = (
  event: string,
  ws?: CustomWebSocket,
  properties: Record<string, unknown> = {}
) => {
  const role = ws?.isAudioSource
    ? 'audio_source'
    : ws?.isAudioSource === false
    ? 'subscriber'
    : undefined;
  captureServerEvent(event, getDistinctId(ws), {
    streamID: ws?.streamID,
    role,
    ...properties,
  });
};

const emitError = (
  event: string,
  ws: CustomWebSocket | undefined,
  error: unknown,
  properties: Record<string, unknown> = {}
) => {
  captureServerError(event, error, getDistinctId(ws), {
    streamID: ws?.streamID,
    ...properties,
  });
};

export const handleWebSocketConnection = (ws: CustomWebSocket) => {
  console.log('Client connected');
  ws.analyticsId = uuidv4();
  emitEvent('ws_connected', ws, {
    remoteAddress: (ws as any)?._socket?.remoteAddress,
  });

  ws.on('message', (message: string | Buffer, isBinary: boolean) => {
    handleWebSocketMessage(ws, message, isBinary);
  });

  ws.on('close', () => {
    console.log('WebSocket closed');
    emitEvent('ws_closed', ws);
    handleDisconnection(ws);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
    emitError('ws_error', ws, err);
  });
};

const handleWebSocketMessage = (ws: CustomWebSocket, message: string | Buffer, isBinary: boolean) => {
  if (!ws.initialized) {
    handleInitialMessage(ws, message);
  } else {
    handleSubsequentMessages(ws, message, isBinary);
  }
};

const handleInitialMessage = (ws: CustomWebSocket, message: string | Buffer) => {
  let msg;
  try {
    msg = JSON.parse(message.toString());
  } catch (e) {
    console.error('Invalid JSON message received:', message);
    emitError('ws_invalid_json', ws, e, { rawMessage: message.toString() });
    ws.close();
    return;
  }

  if (msg.type === 'start') {
    console.log('start message received:', msg.language);
    emitEvent('start_message_received', ws, { language: msg.language });
    startStream(ws, msg.streamID, msg.language);
  } else if (msg.type === 'subscribe') {
    emitEvent('subscribe_message_received', ws, { streamID: msg.streamID });
    subscribeToStream(ws, msg.streamID);
  } else {
    ws.send(JSON.stringify({ error: 'Invalid message type' }));
    emitEvent('invalid_message_type', ws, { payload: msg });
    ws.close();
  }
};

const startStream = (ws: CustomWebSocket, _streamID?: string, language?: TargetLangCode) => {
  const streamID = uuidv4();
  ws.streamID = streamID;
  ws.isAudioSource = true;
  ws.role = 'audio_source';
  ws.initialized = true;
  const stream = new Stream(ws);
  stream.language = language;
  streams.set(streamID, stream);
  identifyStream(streamID, { role: 'audio_source', language });
  ws.send(JSON.stringify({ type: 'streamID', streamID }));
  stream.isTranscribing = true;
  emitEvent('transcription_session_created', ws, { streamID, language });
  initializeNewAudioStream(stream);
  startTranscription(ws, streamID, language);
};

const subscribeToStream = (ws: CustomWebSocket, streamID: string) => {
  if (streams.has(streamID)) {
    const stream = streams.get(streamID)!;
    stream.subscribers.add(ws);
    ws.streamID = streamID;
    ws.isAudioSource = false;
    ws.role = 'subscriber';
    ws.initialized = true;
    console.log(`Client subscribed to streamID: ${streamID}`);
    emitEvent('subscriber_join_success', ws, {
      streamID,
      subscriberCount: stream.subscribers.size,
    });
  } else {
    ws.send(JSON.stringify({ error: 'Invalid streamID' }));
    emitEvent('subscriber_join_failed', ws, {
      reason: 'invalid_stream',
      attemptedStreamID: streamID,
    });
    ws.close();
  }
};

const handleSubsequentMessages = (ws: CustomWebSocket, message: string | Buffer, isBinary: boolean) => {
  const stream = streams.get(ws.streamID!);

  if (ws.isAudioSource) {
    if (isBinary) {
      if (stream) {
        setTimeout(() => resetInactivityTimer(ws, stream), 2000); // slight delay to make sure the stream is processed fully
      }

      if (stream && stream.isTranscribing && stream.audioStream) {
        stream.audioStream.write(message);
      }
    } else {
      handleControlMessages(ws, message.toString());
    }
  } else {
    console.log('Subscriber sent unexpected message');
    emitEvent('subscriber_unexpected_message', ws, {
      streamID: ws.streamID,
    });
  }
};

const stopTranscription = (ws: CustomWebSocket) => {
  const stream = streams.get(ws.streamID!);
  if (stream) {
    stream.isTranscribing = false;
    stream.abortController?.abort();
    stream.abortController = null;
    console.log(`Transcription stopped for streamID: ${ws.streamID}`);
    emitEvent('transcription_stopped', ws, { streamID: ws.streamID });
  }
};

const pauseTranscription = (ws: CustomWebSocket) => {
  const stream = streams.get(ws.streamID!);
  if (stream) {
    stream.isTranscribing = false;

    console.log(`Transcription paused for streamID: ${ws.streamID}`);
    emitEvent('transcription_paused', ws, { streamID: ws.streamID });
  }
};

const destroyAudioStream = (stream: Stream) => {
  if (stream.audioStream) {
    stream.audioStream.end();
    setTimeout(() => stream.audioStream!.destroy(), 300);
    stream.audioStream = null;
    captureServerEvent('audio_stream_destroyed', stream.audioSource.streamID, {
      streamID: stream.audioSource.streamID,
    });
  }
};

const handleControlMessages = (ws: CustomWebSocket, message: string) => {
  let msg;
  try {
    msg = JSON.parse(message);
  } catch (e) {
    console.error('Invalid JSON message received:', message);
    emitError('control_invalid_json', ws, e, { payload: message });
    return;
  }

  if (msg.type === 'stop') {
    console.log('stop message received');
    stopTranscription(ws);
    emitEvent('control_stop_received', ws);
  } else if (msg.type === 'pause') {
    console.log('pause message received');
    pauseTranscription(ws);
    emitEvent('control_pause_received', ws);
  } else if (msg.type === 'start') {
    const stream = streams.get(ws.streamID!);
    if (stream) {
      initializeNewAudioStream(stream);
      stream.isTranscribing = true;
      startTranscription(ws, ws.streamID!, msg.language);
      emitEvent('control_start_received', ws, { language: msg.language });
    }
  } else if (msg.type === 'change_language') {
    changeLanguage(ws, msg.language);
  }
};

// Integrated handleDisconnection function
const handleDisconnection = (ws: CustomWebSocket) => {
  const streamID = ws.streamID;
  if (streamID && streams.has(streamID)) {
    const stream = streams.get(streamID)!;

    if (stream.audioSource === ws) {
      console.log(`Audio source disconnected for streamID: ${streamID}`);
      emitEvent('audio_source_disconnected', ws, {
        streamID,
        subscriberCount: stream.subscribers.size,
      });

      // Notify all subscribers that the stream has ended
      stream.subscribers.forEach((subscriber) => {
        subscriber.send(JSON.stringify({ type: 'end', streamID }));
        subscriber.close();
      });

      // Clear inactivity timeout if exists
      if (stream.inactivityTimeout) {
        clearTimeout(stream.inactivityTimeout);
        stream.inactivityTimeout = null;
      }

      // Clean up stream resources
      if (stream.listenerCleanup) {
        stream.listenerCleanup();
        stream.listenerCleanup = null;
      }

      if (stream.audioStream) {
        destroyAudioStream(stream);
      }

      // Remove the stream from the map
      streams.delete(streamID);
      captureServerEvent('stream_removed', streamID, { streamID });
    } else if (stream.subscribers.has(ws)) {
      // Remove the subscriber from the set of subscribers
      stream.subscribers.delete(ws);
      console.log(`Subscriber disconnected from streamID: ${streamID}`);
      emitEvent('subscriber_disconnected', ws, { streamID });
    }
  }
};

export const initializeNewAudioStream = (stream: Stream) => {
  if (stream.audioStream) {
    stream.audioStream.destroy();
  }
  stream.audioStream = new PassThrough();
  captureServerEvent('audio_stream_initialized', stream.audioSource.streamID, {
    streamID: stream.audioSource.streamID,
  });
};

const changeLanguage = async (ws: CustomWebSocket, newLanguage: TargetLangCode) => {
  emitEvent('language_change_requested', ws, { newLanguage });
  pauseTranscription(ws);
  const stream = streams.get(ws.streamID!);
  if (stream) {
    stream.isTranscribing = true;
    startStream(ws, ws.streamID!, newLanguage);
  }
};
