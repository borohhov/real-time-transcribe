// public/script.js

let socket;
let audioContext;
let processor;
let input;
let fullTranscript = '';

const startButton = document.getElementById('start-button');
const stopButton = document.getElementById('stop-button');
const transcriptionDiv = document.getElementById('transcription');

startButton.addEventListener('click', startTranscription);
stopButton.addEventListener('click', stopTranscription);

async function startTranscription() {
  startButton.disabled = true;
  stopButton.disabled = false;
  transcriptionDiv.innerHTML = '';

  fullTranscript = '';

  // Initialize WebSocket
  socket = new WebSocket('ws://localhost:3000');

  socket.onopen = () => {
    console.log('WebSocket connection opened');
    initializeAudioStream();
  };

  socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.transcript) {
      if (data.isPartial) {
        // Display partial transcript
        updatePartialTranscript(data.transcript);
      } else {
        // Add finalized transcript to full transcript
        fullTranscript += data.transcript + '\n';
        transcriptionDiv.innerText = fullTranscript;
      }
    }
  };

  socket.onerror = (error) => {
    console.error('WebSocket error:', error);
  };

  socket.onclose = () => {
    console.log('WebSocket connection closed');
  };
}

function stopTranscription() {
  startButton.disabled = false;
  stopButton.disabled = true;

  if (processor && processor.port) {
    processor.port.close();
  }
  if (audioContext) {
    audioContext.close();
  }
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.close();
  }
}

async function initializeAudioStream() {
  audioContext = new (window.AudioContext || window.webkitAudioContext)({
    sampleRate: 44100,
  });

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  input = audioContext.createMediaStreamSource(stream);

  processor = audioContext.createScriptProcessor(4096, 1, 1);
  processor.onaudioprocess = (e) => {
    const inputData = e.inputBuffer.getChannelData(0);
    const inputData16 = downsampleBuffer(
      inputData,
      audioContext.sampleRate,
      44100
    );
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(inputData16);
    }
  };

  input.connect(processor);
  processor.connect(audioContext.destination);
}

// Downsample audio buffer to 44100 Hz
function downsampleBuffer(buffer, sampleRate, outSampleRate) {
  if (outSampleRate === sampleRate) {
    return encodePCM(buffer);
  }
  const sampleRateRatio = sampleRate / outSampleRate;
  const newLength = Math.round(buffer.length / sampleRateRatio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
    let accum = 0,
      count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
      accum += buffer[i];
      count++;
    }
    result[offsetResult] = accum / count;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return encodePCM(result);
}

// Convert Float32Array to Int16Array PCM
function encodePCM(samples) {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < samples.length; i++) {
    let s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

// Function to update the partial transcript
function updatePartialTranscript(partialTranscript) {
  // Combine the full transcript with the partial one
  transcriptionDiv.innerText = fullTranscript + partialTranscript;
  transcriptionDiv.scrollTop = transcriptionDiv.scrollHeight;
}
