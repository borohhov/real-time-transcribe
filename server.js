// server.js

require('dotenv').config(); // Load environment variables from .env

const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const {
  TranscribeStreamingClient,
  StartStreamTranscriptionCommand,
} = require('@aws-sdk/client-transcribe-streaming');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Configure AWS credentials and region
const transcribeClient = new TranscribeStreamingClient({
  region: process.env.AWS_REGION, // Ensure AWS_REGION is set in your .env file
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Serve static files from 'public' directory
app.use(express.static('public'));

wss.on('connection', (ws) => {
  console.log('Client connected');

  startTranscription(ws);
});

// Start the server
server.listen(3000, () => {
  console.log('Server started on http://localhost:3000');
});

function startTranscription(ws) {
  // Async generator function to provide audio chunks
  const audioStream = async function* () {
    let isClosed = false;

    ws.on('close', () => {
      console.log('WebSocket closed');
      isClosed = true;
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err);
      isClosed = true;
    });

    // Create a promise that resolves when 'message' event occurs
    const getNextChunk = () =>
      new Promise((resolve) => {
        ws.once('message', (data) => {
          resolve(data);
        });
      });

    while (!isClosed) {
      const chunk = await getNextChunk();
      if (chunk) {
        yield { AudioEvent: { AudioChunk: chunk } };
      }
    }
  };

  (async () => {
    const command = new StartStreamTranscriptionCommand({
      LanguageCode: 'en-US', // Replace with your language code
      MediaEncoding: 'pcm',
      MediaSampleRateHertz: 44100,
      AudioStream: audioStream(),
    });

    try {
      const response = await transcribeClient.send(command);

      for await (const event of response.TranscriptResultStream) {
        if (event.TranscriptEvent) {
          const results = event.TranscriptEvent.Transcript.Results;
          if (results.length > 0) {
            const result = results[0];
            const transcript = result.Alternatives[0].Transcript;

            // Send both partial and final transcripts
            ws.send(
              JSON.stringify({
                transcript,
                isPartial: result.IsPartial,
              })
            );
          }
        }
      }
    } catch (err) {
      console.error('Transcribe client error:', err);
    }
  })();
}
