// src/controllers/streamController.ts
import { CustomWebSocket } from '../common/customWebSocket';
import { v4 as uuidv4 } from 'uuid';
import { startTranscription } from './transcriptionController';
import { Stream, streams } from '../common/stream';
import { PassThrough } from 'node:stream';
import { TargetLangCode } from '../common/supportedLanguageCodes';
import { resetInactivityTimer } from './streamInactivityController';

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
    console.log('start message received:', msg.language);
    startStream(ws, msg.streamID, msg.language);
  } else if (msg.type === 'subscribe') {
    subscribeToStream(ws, msg.streamID);
  } else {
    ws.send(JSON.stringify({ error: 'Invalid message type' }));
    ws.close();
  }
};

const startStream = (ws: CustomWebSocket, streamID?: string, language?: TargetLangCode) => {
  streamID = uuidv4();
  ws.streamID = streamID;
  ws.isAudioSource = true;
  ws.initialized = true;
  const stream = new Stream(ws);
  streams.set(streamID!, stream);
  ws.send(JSON.stringify({ type: 'streamID', streamID }));
  stream.isTranscribing = true;
  initializeNewAudioStream(stream);
  startTranscription(ws, streamID, language);
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
  const stream = streams.get(ws.streamID!);
  
  if (ws.isAudioSource) {
    if (isBinary) {
      setTimeout(() => resetInactivityTimer(ws, stream!), 2000);  // slight delay to make sure the stream is processed fully
      
      if (stream && stream.isTranscribing && stream.audioStream) {
        stream.audioStream.write(message);
      }
    } else {
      handleControlMessages(ws, message.toString());
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

const pauseTranscription = (ws: CustomWebSocket) => {
  const stream = streams.get(ws.streamID!);
  if (stream) {
    stream.isTranscribing = false;
    
    console.log(`Transcription paused for streamID: ${ws.streamID}`);
  }
};

const destroyAudioStream = (stream: Stream) => {
  if (stream.audioStream) {
    stream.audioStream.end();
    setTimeout(() => stream.audioStream!.destroy(), 300)
    stream.audioStream = null;
  }
}

const handleControlMessages = (ws: CustomWebSocket, message: string) => {
  let msg;
  try {
    msg = JSON.parse(message);
  } catch (e) {
    console.error('Invalid JSON message received:', message);
    return;
  }

  if (msg.type === 'stop') {
    console.log('stop message received');
    stopTranscription(ws);
  } else if (msg.type === 'pause') {
    console.log('pause message received');
    pauseTranscription(ws);
  } else if (msg.type === 'start') {
    const stream = streams.get(ws.streamID!);
    if (stream) {
      initializeNewAudioStream(stream);
      stream.isTranscribing = true;
      startTranscription(ws, ws.streamID!, msg.language);
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


const changeLanguage = async (ws: CustomWebSocket, newLanguage: TargetLangCode) => {
  pauseTranscription(ws);
  const stream = streams.get(ws.streamID!);
  if(stream) {
    //destroyAudioStream(stream);
    stream!.isTranscribing = true;
    startStream(ws, ws.streamID!, newLanguage);
  }
    

};

