// src/server.ts
import express, { Application } from 'express';
import http from 'http';
import WebSocket, { WebSocketServer} from 'ws';
import dotenv from 'dotenv';
import path from 'path';
import { handleWebSocketConnection } from './controllers/streamController';

dotenv.config();

const app: Application = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server: server });

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, '../public')));

// Serve subscriber page
app.get('/stream', (req, res) => {
  res.sendFile('subscriber.html', { root: path.join(__dirname, '../public') });
});

wss.on('connection', handleWebSocketConnection);

// Start the server
server.listen(3000, () => {
  console.log('Server started on http://localhost:3000');
});
