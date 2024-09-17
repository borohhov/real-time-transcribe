// src/controllers/streamController.ts
import { CustomWebSocket } from '../types/customWebSocket';
import { v4 as uuidv4 } from 'uuid';
import { startTranscription } from './transcriptionController';
import { Stream, streams } from '../types/stream';
import { PassThrough } from 'node:stream';

export const handleWebSocketConnection = (ws: CustomWebSocket) => {
  console.log('Client connected');

  ws.on('message', (message: string | Buffer, isBinary: boolean) => {
    handleWebSocketMessage(ws, message, isBinary);
  });

  ws.on('close', () => {
    console.log('WebSocket closed');
    handleDisconnection(ws);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
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
    ws.close();
    return;
  }

  if (msg.type === 'start') {
    startNewOrExistingStream(ws, msg.streamID);
  } else if (msg.type === 'subscribe') {
    subscribeToStream(ws, msg.streamID);
  } else {
    ws.send(JSON.stringify({ error: 'Invalid message type' }));
    ws.close();
  }
};

const startNewOrExistingStream = (ws: CustomWebSocket, streamID?: string) => {
  if (streamID && streams.has(streamID)) {
    const stream = streams.get(streamID)!;
    ws.streamID = streamID;
    ws.isAudioSource = true;
    ws.initialized = true;
    stream.audioSource = ws;
    stream.isTranscribing = true;
    initializeNewAudioStream(stream);
    ws.send(JSON.stringify({ type: 'streamID', streamID }));
    startTranscription(ws, streamID);
  } else {
    streamID = uuidv4();
    ws.streamID = streamID;
    ws.isAudioSource = true;
    ws.initialized = true;
    streams.set(streamID!, new Stream(ws));
    ws.send(JSON.stringify({ type: 'streamID', streamID }));
    startTranscription(ws, streamID!);
  }
};

const subscribeToStream = (ws: CustomWebSocket, streamID: string) => {
  if (streams.has(streamID)) {
    const stream = streams.get(streamID)!;
    stream.subscribers.add(ws);
    ws.streamID = streamID;
    ws.isAudioSource = false;
    ws.initialized = true;
    console.log(`Client subscribed to streamID: ${streamID}`);
  } else {
    ws.send(JSON.stringify({ error: 'Invalid streamID' }));
    ws.close();
  }
};

const handleSubsequentMessages = (ws: CustomWebSocket, message: string | Buffer, isBinary: boolean) => {
  if (ws.isAudioSource) {
    if (isBinary) {
      const stream = streams.get(ws.streamID!);
      if (stream && stream.isTranscribing && stream.audioStream) {
        stream.audioStream.write(message);
      }
    } else {
      let msg;
      try {
        msg = JSON.parse(message.toString());
      } catch (e) {
        console.error('Invalid JSON message received:', message);
        return;
      }

      if (msg.type === 'stop') {
        stopTranscription(ws);
      }
    }
  } else {
    console.log('Subscriber sent unexpected message');
  }
};

const stopTranscription = (ws: CustomWebSocket) => {
  const stream = streams.get(ws.streamID!);
  if (stream) {
    stream.isTranscribing = false;
    stream.abortController?.abort();
    stream.abortController = null;
    console.log(`Transcription stopped for streamID: ${ws.streamID}`);
  }
};

// Integrated handleDisconnection function
const handleDisconnection = (ws: CustomWebSocket) => {
  const streamID = ws.streamID;
  if (streamID && streams.has(streamID)) {
    const stream = streams.get(streamID)!;

    if (stream.audioSource === ws) {
      console.log(`Audio source disconnected for streamID: ${streamID}`);

      // Notify all subscribers that the stream has ended
      stream.subscribers.forEach((subscriber) => {
        subscriber.send(JSON.stringify({ type: 'end', streamID }));
        subscriber.close();
      });

      // Clean up the stream resources
      if (stream.listenerCleanup) {
        stream.listenerCleanup();
        stream.listenerCleanup = null;
      }

      if (stream.audioStream) {
        stream.audioStream.destroy();
        stream.audioStream = null;
      }

      // Remove the stream from the map
      streams.delete(streamID);
    } else if (stream.subscribers.has(ws)) {
      // Remove the subscriber from the set of subscribers
      stream.subscribers.delete(ws);
      console.log(`Subscriber disconnected from streamID: ${streamID}`);
    }
  }
};

export const initializeNewAudioStream = (stream: Stream) => {
  if (stream.audioStream) {
    stream.audioStream.destroy();
  }
  stream.audioStream = new PassThrough();
};