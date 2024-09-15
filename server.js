// server.js

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();
const { AbortController } = require('node-abort-controller');
const {
  TranscribeStreamingClient,
  StartStreamTranscriptionCommand,
} = require('@aws-sdk/client-transcribe-streaming');
const { PassThrough } = require('stream');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files from 'public' directory
app.use(express.static('public'));

// Serve subscriber page
app.get('/stream', (req, res) => {
  res.sendFile(__dirname + '/public/subscriber.html');
});

const transcribeClient = new TranscribeStreamingClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Map of streamID to { audioSource: ws, subscribers: Set<ws>, isTranscribing: boolean, listenerCleanup: function, audioStream: PassThrough }
const streams = new Map();

wss.on('connection', (ws) => {
  console.log('Client connected');

  ws.on('message', (message, isBinary) => {
    if (!ws.initialized) {
      let msg;
      try {
        msg = JSON.parse(message);
      } catch (e) {
        console.error('Invalid JSON message received:', message);
        ws.close();
        return;
      }

      if (msg.type === 'start') {
        let streamID = msg.streamID;

        if (streamID && streams.has(streamID)) {
          // Reuse existing stream
          ws.streamID = streamID;
          ws.isAudioSource = true;
          ws.initialized = true;

          const stream = streams.get(streamID);
          stream.audioSource = ws;
          stream.isTranscribing = true;

          // Ensure a fresh PassThrough stream each time transcription starts
          initializeNewAudioStream(stream);

          console.log(`Audio source reconnected with streamID: ${streamID}`);
          ws.send(JSON.stringify({ type: 'streamID', streamID }));
          startTranscription(ws, streamID);
        } else {
          // Create a new stream
          streamID = uuidv4();
          ws.streamID = streamID;
          ws.isAudioSource = true;
          ws.initialized = true;
          streams.set(streamID, { audioSource: ws, subscribers: new Set(), isTranscribing: true });
          console.log(`Audio source started with streamID: ${streamID}`);
          ws.send(JSON.stringify({ type: 'streamID', streamID }));
          startTranscription(ws, streamID);
        }
      } else if (msg.type === 'subscribe') {
        const { streamID } = msg;
        if (streams.has(streamID)) {
          const stream = streams.get(streamID);
          stream.subscribers.add(ws);
          ws.streamID = streamID;
          ws.isAudioSource = false;
          ws.initialized = true;
          console.log(`Client subscribed to streamID: ${streamID}`);
        } else {
          ws.send(JSON.stringify({ error: 'Invalid streamID' }));
          ws.close();
        }
      } else {
        ws.send(JSON.stringify({ error: 'Invalid message type' }));
        ws.close();
      }
    } else {
      // Handle subsequent messages
      if (ws.isAudioSource) {
        if (isBinary) {
          const stream = streams.get(ws.streamID);
          if (stream && stream.isTranscribing && stream.audioStream) {
            stream.audioStream.write(message);
          }
        } else {
          let msg;
          try {
            msg = JSON.parse(message);
          } catch (e) {
            console.error('Invalid JSON message received:', message);
            return;
          }

          if (msg.type === 'stop') {
            const streamID = ws.streamID;
            const stream = streams.get(streamID);
            if (stream) {
              stream.isTranscribing = false;
              
              if (stream.abortController) {
                stream.abortController.abort(); // Abort the transcription safely
                stream.abortController = null; // Remove the reference
              }
              console.log(`Transcription stopped for streamID: ${streamID}`);
              if (ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) {
                ws.close();
                console.log(`Websocket closed for streamID: ${streamID}`);
              }
            }
          }
        }
      } else {
        console.log('Subscriber sent unexpected message');
      }
    }
  });

  ws.on('close', () => {
    console.log('WebSocket closed');
    handleDisconnection(ws);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });
});

// Start the server
server.listen(3000, () => {
  console.log('Server started on http://localhost:3000');
});

function initializeNewAudioStream(stream) {
  // Create a new PassThrough stream for audio data
  if (stream.audioStream) {
    stream.audioStream.destroy(); // Ensure any previous stream is closed properly
  }
  stream.audioStream = new PassThrough();
}

function startTranscription(ws, streamID) {
  const stream = streams.get(streamID);
  if (!stream) {
    console.error('Stream not found for startTranscription');
    return;
  }

  // Cleanup any old state
  if (stream.audioStream) {
    stream.audioStream.removeAllListeners(); // Remove any lingering listeners
    stream.audioStream = null; // Clear the old reference
  }
  if (stream.abortController) {
    stream.abortController.abort(); // Abort any lingering controller
    stream.abortController = null; // Clear the reference
  }

  // Reinitialize the audio stream to ensure a fresh start
  initializeNewAudioStream(stream);

  const audioStream = stream.audioStream;

  const onClose = () => {
    console.log('WebSocket closed');
    audioStream.end();
  };

  const onError = (err) => {
    console.error('WebSocket error:', err);
    audioStream.end();
  };

  ws.on('close', onClose);
  ws.on('error', onError);

  // Store listener cleanup function
  stream.listenerCleanup = () => {
    ws.off('close', onClose);
    ws.off('error', onError);
  };

  // Use AbortController to be able to cancel the transcription
  const controller = new AbortController();
  const abortSignal = controller.signal;
  stream.abortController = controller; // Store the controller to be able to cancel it later

  // Create an async generator function to read from audioStream
  async function* getAudioStream() {
    for await (const chunk of audioStream) {
      yield { AudioEvent: { AudioChunk: chunk } };
    }
  }

  (async () => {
    const command = new StartStreamTranscriptionCommand({
      LanguageCode: 'en-US',
      MediaEncoding: 'pcm',
      MediaSampleRateHertz: 44100,
      AudioStream: getAudioStream(),
    });

    try {
      const response = await transcribeClient.send(command, { abortSignal });

      for await (const event of response.TranscriptResultStream) {
        if (!stream.isTranscribing) {
          console.log('Transcription paused, stopping processing of results');
          break;
        }
        if (event.TranscriptEvent) {
          const transcriptEvent = event.TranscriptEvent;
          if (transcriptEvent.Transcript) {
            const results = transcriptEvent.Transcript.Results;
            if (results && results.length > 0) {
              const result = results[0];
              if (result.Alternatives && result.Alternatives.length > 0) {
                const transcript = result.Alternatives[0].Transcript;

                // Send transcriptions to all subscribers and the audio source
                const message = JSON.stringify({
                  type: 'transcript',
                  transcript,
                  isPartial: result.IsPartial,
                  streamID,
                });

                // Send to subscribers
                for (const subscriber of stream.subscribers) {
                  if (subscriber.readyState === WebSocket.OPEN) {
                    subscriber.send(message);
                  }
                }

                // Send to the audio source
                if (stream.audioSource && stream.audioSource.readyState === WebSocket.OPEN) {
                  stream.audioSource.send(message);
                }
              }
            }
          }
        }
      }
      console.log('Transcription session ended');
    } catch (err) {
      if (err.name === 'AbortError') {
        console.log('Transcription aborted');
      } else {
        console.error('Transcribe client error:', err);
      }
    } finally {
      // Clean up listeners and close the stream only after the session has properly ended
      if (stream.listenerCleanup) {
        stream.listenerCleanup();
        stream.listenerCleanup = null;
      }
      if (stream.audioStream) {
        stream.audioStream.end(); // Properly close the stream after the transcription session ends
        stream.audioStream.on('finish', () => {
          stream.audioStream = null;
        });
      }
    }
  })();
}


function handleDisconnection(ws) {
  const streamID = ws.streamID;
  if (streamID && streams.has(streamID)) {
    const stream = streams.get(streamID);

    if (stream.audioSource === ws) {
      console.log(`Audio source disconnected for streamID: ${streamID}`);
      // Notify subscribers that the stream has ended
      for (const subscriber of stream.subscribers) {
        subscriber.send(JSON.stringify({ type: 'end', streamID }));
        subscriber.close();
      }
      if (stream.listenerCleanup) {
        stream.listenerCleanup();
        stream.listenerCleanup = null;
      }
      if (stream.audioStream) {
        stream.audioStream.destroy();
        stream.audioStream = null;
      }
      streams.delete(streamID);
    } else if (stream.subscribers.has(ws)) {
      stream.subscribers.delete(ws);
      console.log(`Subscriber disconnected from streamID: ${streamID}`);
    }
  }
}
