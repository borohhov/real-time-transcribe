// public/subscriber.js

let socket;
let streamID = null;

const transcriptionContainer = document.getElementById('transcription-container');

function startSubscription() {
  // Get the streamID from the URL parameters
  const params = new URLSearchParams(window.location.search);
  streamID = params.get('streamID');

  if (!streamID) {
    alert('No streamID provided in the URL.');
    return;
  }

  // Initialize WebSocket
  socket = new WebSocket('ws://localhost:3000');

  socket.onopen = () => {
    console.log('WebSocket connection opened');

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
      stopSubscription();
    } else if (data.error) {
      console.error('Error from server:', data.error);
      alert(`Error: ${data.error}`);
      stopSubscription();
    } else {
      console.log('Unknown message type:', data);
    }
  };

  socket.onerror = (error) => {
    console.error('WebSocket error:', error);
  };

  socket.onclose = () => {
    console.log('WebSocket connection closed');
  };
}

function stopSubscription() {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.close();
  }
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
  }
}

// Start the subscription when the page loads
window.onload = startSubscription;
