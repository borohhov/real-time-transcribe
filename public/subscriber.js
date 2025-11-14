// public/subscriber.js
let socket;
let streamID = null;

const analytics = window.appAnalytics;
const subscriberSessionId =
  (typeof crypto !== 'undefined' && crypto.randomUUID && crypto.randomUUID()) ||
  `subscriber-${Date.now()}-${Math.random().toString(16).slice(2)}`;
analytics?.init('subscriber', { page: 'subscriber', subscriberSessionId });
analytics?.capture('subscriber_ui_loaded', {
  subscriberSessionId,
  userAgent: navigator.userAgent,
});
analytics?.setContext({ subscriberSessionId });

const transcriptionContainer = document.getElementById('transcription-container');
let subscriberSessionStartTime = null;
let subscriberFirstTranscriptLogged = false;
let subscriberFinalTranscriptCount = 0;

function startSubscription() {
  // Get the streamID from the URL parameters
  const params = new URLSearchParams(window.location.search);
  streamID = params.get('streamID');

  if (!streamID) {
    alert('No streamID provided in the URL.');
    analytics?.capture('subscriber_join_failed', {
      subscriberSessionId,
      reason: 'missing_stream_id',
    });
    return;
  }

  subscriberSessionStartTime = Date.now();
  analytics?.setContext({ streamID });
  analytics?.capture('subscriber_join_attempted', {
    subscriberSessionId,
    streamID,
  });

  // Initialize WebSocket
  const wsProtocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
  const wsHost = window.location.host;
  socket = new WebSocket(`${wsProtocol}${wsHost}`);

  socket.onopen = () => {
    console.log('WebSocket connection opened');
    analytics?.capture('subscriber_socket_opened', { streamID, subscriberSessionId });

    // Send initial message to subscribe to a stream
    socket.send(JSON.stringify({ type: 'subscribe', streamID }));
  };

  socket.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.type === 'transcript') {
      const { transcript, isPartial } = data;
      updateTranscription(transcript, isPartial);
    } else if (data.type === 'end') {
      console.log('Stream has ended.');
      analytics?.capture('subscriber_stream_end', { streamID, subscriberSessionId });
      stopSubscription('stream_end');
    } else if (data.error) {
      console.error('Error from server:', data.error);
      alert(`Error: ${data.error}`);
      analytics?.capture('subscriber_join_failed', {
        streamID,
        subscriberSessionId,
        reason: data.error,
      });
      stopSubscription('server_error');
    } else {
      console.log('Unknown message type:', data);
      analytics?.capture('subscriber_unknown_message', { streamID, subscriberSessionId, payload: data });
    }
  };

  socket.onerror = (error) => {
    console.error('WebSocket error:', error);
    analytics?.capture('subscriber_socket_error', {
      streamID,
      subscriberSessionId,
      errorMessage: error.message || 'unknown',
      errorType: error.type,
    });
  };

  socket.onclose = () => {
    console.log('WebSocket connection closed');
    analytics?.capture('subscriber_socket_closed', { streamID, subscriberSessionId });
  };
}

function stopSubscription(reason = 'manual') {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.close();
  }
  analytics?.capture('subscriber_session_stopped', {
    streamID,
    subscriberSessionId,
    reason,
    durationMs: subscriberSessionStartTime ? Date.now() - subscriberSessionStartTime : null,
    finalTranscriptCount: subscriberFinalTranscriptCount,
  });
}

let partialLine = null;
let previousWords = [];

function updateTranscription(transcript, isPartial) {
  if (!subscriberFirstTranscriptLogged && subscriberSessionStartTime) {
    subscriberFirstTranscriptLogged = true;
    analytics?.capture('subscriber_first_transcript_received', {
      streamID,
      subscriberSessionId,
      latencyMs: Date.now() - subscriberSessionStartTime,
      isPartial,
    });
  }

  if (isPartial) {
    const words = transcript.split(' ');
    if (!partialLine) {
      // Create a new line for partial transcript
      partialLine = document.createElement('div');
      partialLine.className = 'transcription-line partial';
      transcriptionContainer.appendChild(partialLine);
    }

    // Clear the partial line
    partialLine.innerHTML = '';

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
    subscriberFinalTranscriptCount += 1;
    analytics?.capture('subscriber_transcript_finalized', {
      streamID,
      subscriberSessionId,
      finalTranscriptCount: subscriberFinalTranscriptCount,
      length: transcript.length,
    });
  }
}

// Start the subscription when the page loads
window.onload = startSubscription;
