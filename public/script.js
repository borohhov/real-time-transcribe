// public/script.js
let socket;
let audioContext;
let processor;
let input;
let fullTranscript = '';
let mediaStream;
let streamID = null; // To store the streamID assigned by the server
let isTranscribing = false; // To track transcription state
let isPaused = false;
let partialLine = null;
let previousWords = [];
const startButton = document.getElementById('start-button');
const pauseButton = document.getElementById('pause-button');
const stopButton = document.getElementById('stop-button');

const transcriptionContainer = document.getElementById('transcription-container');
const streamIDElement = document.getElementById('stream-id'); // Element to display streamID
const streamLinkInput = document.getElementById('stream-link');
const copyLinkButton = document.getElementById('copy-link-button');
const languageSelect = document.getElementById('language-select');
const controls = document.getElementById('controls');
// QR code container (if you're using QR codes)
const qrCodeContainer = document.getElementById('qr-code');

let selectedLanguage = 'en-US';

const analytics = window.appAnalytics;

analytics?.setContext({ targetLanguage: selectedLanguage });

const hostSessionId =
  (typeof crypto !== 'undefined' && crypto.randomUUID && crypto.randomUUID()) ||
  `host-${Date.now()}-${Math.random().toString(16).slice(2)}`;
analytics?.init('host', { page: 'broadcaster', hostSessionId });
analytics?.capture('host_ui_loaded', {
  hostSessionId,
  userAgent: navigator.userAgent,
});
analytics?.setContext({ hostSessionId });

let hostSessionStartTime = null;
let firstTranscriptLogged = false;
let finalTranscriptCount = 0;
let totalFinalCharacters = 0;
let controlsHidden = false;

startButton.addEventListener('click', startTranscription);
stopButton.addEventListener('click', stopTranscription);
pauseButton.addEventListener('click', pauseTranscription);
languageSelect.addEventListener('change', onLanguageChange);
document.addEventListener('mousemove', resetInactivityTimer);
document.addEventListener('touchstart', resetInactivityTimer);
document.addEventListener('keydown', resetInactivityTimer); 

/*copyLinkButton.addEventListener('click', () => {
  streamLinkInput.select();
  document.execCommand('copy');
  alert('Link copied to clipboard!');
});*/

function onLanguageChange() {
  selectedLanguage = languageSelect.value;
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'change_language', language: selectedLanguage }));
  }
  analytics?.setContext({ targetLanguage: selectedLanguage });
  analytics?.capture('language_changed', {
    hostSessionId,
    streamID,
    language: selectedLanguage,
  });
}
let inactivityTimeout = null; // To track inactivity and hide the controls

function resetInactivityTimer() {
  // Make the controls visible when there is activity
  controls.classList.add('visible');
  controls.classList.remove('hidden');

  if (controlsHidden) {
    analytics?.capture('controls_shown', { hostSessionId, streamID });
    controlsHidden = false;
  }

  // Clear any previous inactivity timeout
  if (inactivityTimeout) {
    clearTimeout(inactivityTimeout);
  }

  // Set a new timeout to hide the controls after 3 seconds of inactivity
  inactivityTimeout = setTimeout(() => {
    controls.classList.add('hidden');
    controls.classList.remove('visible');
    controlsHidden = true;
    analytics?.capture('controls_hidden', { hostSessionId, streamID });
  }, 3000); // 3 seconds of inactivity
}

function resetSessionMetrics() {
  hostSessionStartTime = Date.now();
  firstTranscriptLogged = false;
  finalTranscriptCount = 0;
  totalFinalCharacters = 0;
}

async function startTranscription() {
  requestWakeLock();
  if (isTranscribing && !isPaused) {
    console.log('Already transcribing');
    analytics?.capture('host_start_ignored', { reason: 'already_transcribing', streamID });
    return;
  }

  if (isPaused) {
    // Resume transcription
    isPaused = false;
    startButton.disabled = true;
    pauseButton.disabled = false;
    stopButton.disabled = false;

    // Send 'start' message to the server to resume transcription
    sendStartMessage();

    // Re-initialize audio stream if necessary
    initializeAudioStream();
    resetInactivityTimer();
    analytics?.capture('host_session_resumed', {
      hostSessionId,
      streamID,
      language: selectedLanguage,
    });
    return;
  }

  // Proceed with starting transcription as before
  startButton.disabled = true;
  stopButton.disabled = false;
  pauseButton.disabled = false;
  transcriptionContainer.innerHTML = '';

  fullTranscript = '';

  resetSessionMetrics();

  analytics?.capture('host_session_started', {
    hostSessionId,
    language: selectedLanguage,
  });

  // Initialize or reuse WebSocket
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    const wsHost = window.location.host;
    socket = new WebSocket(`${wsProtocol}${wsHost}`);

    socket.onopen = () => {
      analytics?.capture('host_socket_opened', { hostSessionId });
      sendStartMessage();
      initializeAudioStream();
    };
    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'streamID') {
        // Server has assigned a streamID to this audio source
        if (!streamID) {
          streamID = data.streamID;
          console.log('Assigned streamID:', streamID);
          analytics?.setContext({ streamID });
          analytics?.capture('share_link_created', {
            streamID,
            hostSessionId,
          });

          // Display the streamID and the shareable link
          if (streamIDElement && streamLinkInput) {
            streamIDElement.textContent = streamID;
            const streamURL = `${window.location.origin}/stream?streamID=${streamID}`;
            streamLinkInput.value = streamURL;
            analytics?.capture('share_link_populated', {
              streamID,
              hostSessionId,
            });

            // Generate QR code (if applicable)
            if (qrCodeContainer) {
              // Clear previous QR code if any
              qrCodeContainer.innerHTML = '';

              new QRCode(qrCodeContainer, {
                text: streamURL,
                width: 128,
                height: 128,
              });
              analytics?.capture('qr_rendered', {
                streamID,
                hostSessionId,
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
        analytics?.capture('host_stream_end_received', { streamID, hostSessionId });
        stopTranscription('stream_end');
      } else if (data.error) {
        // Handle error messages
        console.error('Error from server:', data.error);
        analytics?.capture('host_server_error', { streamID, hostSessionId, error: data.error });
      } else {
        console.log('Unknown message type:', data);
        analytics?.capture('host_unknown_message', { payload: data, streamID, hostSessionId });
      }
    };

    socket.onerror = (error) => {
      console.error('WebSocket error:', error);
      analytics?.capture('host_socket_error', {
        hostSessionId,
        streamID,
        errorMessage: error.message || 'unknown',
        errorType: error.type,
      });
    };

    socket.onclose = () => {
      console.log('WebSocket connection closed');
      isTranscribing = false;
      startButton.disabled = false;
      stopButton.disabled = true;
      analytics?.capture('host_socket_closed', { streamID, hostSessionId });
    };
  } else {
    // If WebSocket is already open, just send the start message
    sendStartMessage();
    initializeAudioStream();
  }

  isTranscribing = true;
}


function sendStartMessage() {
  const message = { type: 'start', language: selectedLanguage };
  if (streamID) {
    message.streamID = streamID;
  }
  socket.send(JSON.stringify(message));
  analytics?.capture('host_start_message_sent', {
    hostSessionId,
    streamID,
    language: selectedLanguage,
  });
}

function pauseTranscription() {
  releaseWakeLock();
  if (!isTranscribing || isPaused) return;

  isPaused = true;
  startButton.disabled = false;
  pauseButton.disabled = true;
  stopButton.disabled = false;

  // Send 'pause' message to the server
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'pause' }));
  }

  analytics?.capture('host_session_paused', {
    hostSessionId,
    streamID,
    elapsedMs: hostSessionStartTime ? Date.now() - hostSessionStartTime : null,
  });

  // Stop the audio processing
  if (processor && processor.port) {
    processor.port.close();
  }
  if (audioContext) {
    audioContext.suspend();
  }
  resetInactivityTimer();
}



function stopTranscription(reason = 'manual') {
  releaseWakeLock();
  if (!isTranscribing) {
    console.log('Not currently transcribing');
    return;
  }

  // Set both flags to false since we're stopping transcription
  isTranscribing = false;
  isPaused = false;

  // Update button states
  startButton.disabled = false;
  pauseButton.disabled = true;
  stopButton.disabled = true;

  // Send 'stop' message to the server
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'stop', streamID }));
  }

  analytics?.capture('host_session_stopped', {
    hostSessionId,
    streamID,
    reason,
    durationMs: hostSessionStartTime ? Date.now() - hostSessionStartTime : null,
    finalTranscriptCount,
    totalFinalCharacters,
  });

  // Close audio processing
  if (processor && processor.port) {
    processor.port.close();
  }
  if (audioContext) {
    audioContext.close();
  }

  // Stop media stream tracks
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
  }

  // Reset variables
  audioContext = null;
  processor = null;
  input = null;
  mediaStream = null;
  resetInactivityTimer();
}


async function initializeAudioStream() {
  try {
    if (audioContext && audioContext.state === 'suspended') {
      await audioContext.resume();
      analytics?.capture('audio_context_resumed', { hostSessionId });
    } else {
      audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 44100,
      });

      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      input = audioContext.createMediaStreamSource(mediaStream);

      processor = audioContext.createScriptProcessor(2048, 1, 1);
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

      analytics?.capture('audio_stream_initialized', {
        hostSessionId,
        streamID,
        sampleRate: audioContext.sampleRate,
      });
    }
  } catch (error) {
    console.error('Failed to initialize audio stream', error);
    analytics?.capture('audio_stream_init_failed', {
      hostSessionId,
      streamID,
      errorMessage: error.message,
    });
  }
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


function updateTranscription(transcript, isPartial) {
  if (!firstTranscriptLogged && hostSessionStartTime) {
    firstTranscriptLogged = true;
    analytics?.capture('first_transcript_received', {
      hostSessionId,
      streamID,
      isPartial,
      latencyMs: Date.now() - hostSessionStartTime,
    });
  }

  if (isPartial) {
    const words = transcript.split(' ');
    if (!partialLine) {
      partialLine = document.createElement('div');
      partialLine.className = 'transcription-line partial';
      transcriptionContainer.appendChild(partialLine);
    }
    partialLine.innerHTML = '\n';
    words.forEach((word, index) => {
      const wordSpan = document.createElement('span');
      wordSpan.className = 'word';
      wordSpan.textContent = word + (index < words.length - 1 ? ' ' : '');

      if (previousWords[index] !== word) {
        wordSpan.classList.add('fade-in');
        void wordSpan.offsetHeight;
        wordSpan.classList.remove('fade-in');
      }
      partialLine.appendChild(wordSpan);
    });
    partialLine.scrollIntoView({ behavior: 'smooth', block: 'end' });
    previousWords = words.slice();
  } else {
    if (partialLine) {
      partialLine.classList.remove('partial');
      // Remove fade-in classes from words
      const wordElements = partialLine.getElementsByClassName('word');
      for (let wordElement of wordElements) {
        wordElement.classList.remove('fade-in');
      }
      partialLine.scrollIntoView({ behavior: 'smooth', block: 'end' });
      partialLine = null;
    } else {
      const line = document.createElement('div');
      line.className = 'transcription-line';
      line.textContent = transcript;
      transcriptionContainer.appendChild(line);
      line.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
    previousWords = [];
    finalTranscriptCount += 1;
    totalFinalCharacters += transcript.length;
    analytics?.capture('transcript_finalized', {
      hostSessionId,
      streamID,
      length: transcript.length,
      finalTranscriptCount,
    });
  }
}


const fullscreenButton = document.getElementById('fullscreen-button');

fullscreenButton.addEventListener('click', toggleFullScreen);

function toggleFullScreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen();
    fullscreenButton.innerText = 'Exit Full Screen';
    analytics?.capture('fullscreen_toggled', {
      hostSessionId,
      streamID,
      isFullscreen: true,
    });
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen();
      fullscreenButton.innerText = 'Enter Full Screen';
      analytics?.capture('fullscreen_toggled', {
        hostSessionId,
        streamID,
        isFullscreen: false,
      });
    }
  }
}
