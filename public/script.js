// public/script.js

let socket;
let audioContext;
let processor;
let input;
let fullTranscript = '';
let mediaStream;
let streamID = null; // To store the streamID assigned by the server
let isTranscribing = false; // To track transcription state

const startButton = document.getElementById('start-button');
const stopButton = document.getElementById('stop-button');
const transcriptionContainer = document.getElementById('transcription-container');
const streamIDElement = document.getElementById('stream-id'); // Element to display streamID
const streamLinkInput = document.getElementById('stream-link');
const copyLinkButton = document.getElementById('copy-link-button');

// QR code container (if you're using QR codes)
const qrCodeContainer = document.getElementById('qr-code');

startButton.addEventListener('click', startTranscription);
stopButton.addEventListener('click', stopTranscription);

copyLinkButton.addEventListener('click', () => {
  streamLinkInput.select();
  document.execCommand('copy');
  alert('Link copied to clipboard!');
});

async function startTranscription() {
  if (isTranscribing) {
    console.log('Already transcribing');
    return;
  }

  startButton.disabled = true;
  stopButton.disabled = false;
  transcriptionContainer.innerHTML = '';

  fullTranscript = '';

  // Initialize or reuse WebSocket
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    const wsHost = window.location.host;
    socket = new WebSocket(`${wsProtocol}${wsHost}`);

    socket.onopen = () => {
      console.log('WebSocket connection opened');

      // Send initial message to start a new audio stream
      sendStartMessage();

      // Initialize audio stream after sending the initial message
      initializeAudioStream();
    };

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'streamID') {
        // Server has assigned a streamID to this audio source
        if (!streamID) {
          streamID = data.streamID;
          console.log('Assigned streamID:', streamID);

          // Display the streamID and the shareable link
          if (streamIDElement && streamLinkInput) {
            streamIDElement.textContent = streamID;
            const streamURL = `${window.location.origin}/stream?streamID=${streamID}`;
            streamLinkInput.value = streamURL;

            // Generate QR code (if applicable)
            if (qrCodeContainer) {
              // Clear previous QR code if any
              qrCodeContainer.innerHTML = '';

              new QRCode(qrCodeContainer, {
                text: streamURL,
                width: 128,
                height: 128,
              });
            }
          }
        }
      } else if (data.type === 'transcript') {
        // Received a transcription
        const { transcript, isPartial } = data;
        updateTranscription(transcript, isPartial);
      } else if (data.type === 'end') {
        // Handle end of stream
        console.log('Stream has ended.');
        stopTranscription();
      } else if (data.error) {
        // Handle error messages
        console.error('Error from server:', data.error);
      } else {
        console.log('Unknown message type:', data);
      }
    };

    socket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    socket.onclose = () => {
      console.log('WebSocket connection closed');
      isTranscribing = false;
      startButton.disabled = false;
      stopButton.disabled = true;
    };
  } else {
    // If WebSocket is already open, just send the start message
    sendStartMessage();
    initializeAudioStream();
  }

  isTranscribing = true;
}

function sendStartMessage() {
  const message = { type: 'start' };
  if (streamID) {
    message.streamID = streamID;
  }
  socket.send(JSON.stringify(message));
}

function stopTranscription() {
  if (!isTranscribing) {
    console.log('Not currently transcribing');
    return;
  }

  startButton.disabled = false;
  stopButton.disabled = true;

  if (processor && processor.port) {
    processor.port.close();
  }
  if (audioContext) {
    audioContext.close();
  }

  // Send stop message to the server
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'stop', streamID }));
  }

  // Stop all tracks in the media stream
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
  }

  // Reset variables
  audioContext = null;
  processor = null;
  input = null;
  mediaStream = null;

  isTranscribing = false;
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
    const inputData16 = downsampleBuffer(inputData, audioContext.sampleRate, 44100);
    if (socket.readyState === WebSocket.OPEN) {
      // Send the audio data as binary data
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
let previousLine = null;
function updateTranscription(transcript, isPartial) {
  if (isPartial) {
    // Your existing code for handling partial transcripts
    // ...
  } else {
    // Finalized transcript
    if (partialLine) {
      // Finalize the partial line
      partialLine.classList.remove('partial');
      
      // Remove fade-in classes from words
      const wordElements = partialLine.getElementsByClassName('word');
      for (let wordElement of wordElements) {
        wordElement.classList.remove('fade-in');
      }
      
      // **Apply the new-line class**
      if (previousLine) {
        previousLine.classList.remove('new-line');
      }
      partialLine.classList.add('new-line');
      previousLine = partialLine;
      
      partialLine.scrollIntoView({ behavior: 'smooth', block: 'end' });
      partialLine = null;
    } else {
      // **Handle sentences that appear at once**
      
      // Remove 'new-line' class from previous line
      if (previousLine) {
        previousLine.classList.remove('new-line');
      }
      
      // Create a new line with the 'new-line' class
      const line = document.createElement('div');
      line.className = 'transcription-line new-line';
      line.textContent = transcript;
      transcriptionContainer.appendChild(line);
      
      // Scroll the new line into view
      line.scrollIntoView({ behavior: 'smooth', block: 'end' });
      
      // Update previousLine
      previousLine = line;
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
