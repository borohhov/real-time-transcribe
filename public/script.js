// public/script.js

let socket;
let audioContext;
let processor;
let input;
let fullTranscript = '';
let mediaStream;

const startButton = document.getElementById('start-button');
const stopButton = document.getElementById('stop-button');
const transcriptionContainer = document.getElementById('transcription-container');


startButton.addEventListener('click', startTranscription);
stopButton.addEventListener('click', stopTranscription);

async function startTranscription() {
  startButton.disabled = true;
  stopButton.disabled = false;
  transcriptionContainer.innerHTML = '';

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
      updateTranscription(data.transcript, data.isPartial);
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

  // Stop all tracks in the media stream
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
  }

  // Reset variables
  audioContext = null;
  processor = null;
  input = null;
  mediaStream = null;
}

async function initializeAudioStream() {
  audioContext = new (window.AudioContext || window.webkitAudioContext)({
    sampleRate: 44100,
  });

  mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  input = audioContext.createMediaStreamSource(mediaStream);

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
// Helper function to apply fade-in effect
function fadeIn(element) {
  element.classList.add('fade-in');
  // Force reflow
  void element.offsetHeight;
  // Remove 'fade-in' class to trigger the transition to opacity: 1
  element.classList.remove('fade-in');
}

let partialLine = null;
let previousWords = [];

function updateTranscription(transcript, isPartial) {
  if (isPartial) {
    const words = transcript.split(' ');
    if (!partialLine) {
      // Create a new line for partial transcript
      partialLine = document.createElement('div');
      partialLine.className = 'transcription-line partial';
      transcriptionContainer.appendChild(partialLine);
    }

    // Clear the partial line
    partialLine.innerHTML = '\n';

    words.forEach((word, index) => {
      const wordSpan = document.createElement('span');
      wordSpan.className = 'word';
      wordSpan.textContent = word + (index < words.length - 1 ? ' ' : '');

      // Check if the word is new
      if (previousWords[index] !== word) {
        wordSpan.classList.add('fade-in');
        // Force reflow and remove 'fade-in' class to trigger the transition
        void wordSpan.offsetHeight;
        wordSpan.classList.remove('fade-in');
      }

      partialLine.appendChild(wordSpan);
    });

    // Scroll the partial line into view
    partialLine.scrollIntoView({ behavior: 'smooth', block: 'end' });

    // Update previousWords
    previousWords = words.slice();
  } else {
    // Finalized transcript
    if (partialLine) {
      // Change the class to finalized (remove 'partial' class)
      partialLine.classList.remove('partial');

      // Remove fade-in classes from words
      const wordElements = partialLine.getElementsByClassName('word');
      for (let wordElement of wordElements) {
        wordElement.classList.remove('fade-in');
      }

      // Scroll the finalized line into view
      partialLine.scrollIntoView({ behavior: 'smooth', block: 'end' });

      partialLine = null;
    } else {
      // Append new finalized line
      const line = document.createElement('div');
      line.className = 'transcription-line';
      line.textContent = transcript;
      transcriptionContainer.appendChild(line);

      // Scroll the new line into view
      line.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }

    // Reset previousWords
    previousWords = [];
  }
}

const fullscreenButton = document.getElementById('fullscreen-button');

fullscreenButton.addEventListener('click', toggleFullScreen);

function toggleFullScreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen();
    fullscreenButton.innerText = 'Exit Full Screen';
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen();
      fullscreenButton.innerText = 'Enter Full Screen';
    }
  }
}
