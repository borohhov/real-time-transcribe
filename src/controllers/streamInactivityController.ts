import { INACTIVITY_TIMEOUT_MS, SILENT_AUDIO } from "../common/transcriptionMessage";
import { CustomWebSocket } from "../common/customWebSocket";
import { Stream } from "../common/stream";

export const resetInactivityTimer = (ws: CustomWebSocket, stream: Stream) => {
    if (stream.inactivityTimeout) {
      clearTimeout(stream.inactivityTimeout);
    }
  
    stream.inactivityTimeout = setTimeout(() => {
      handleInactivity(ws, stream);
    }, INACTIVITY_TIMEOUT_MS);
  };
  
  // Function to handle inactivity (either send silence or close the stream)
  const handleInactivity = (ws: CustomWebSocket, stream: Stream) => {
    if (stream && stream.isTranscribing && stream.audioStream) {
      console.log(`No audio for ${INACTIVITY_TIMEOUT_MS / 1000} seconds, sending silence.`);
      stream.audioStream.write(SILENT_AUDIO);
      resetInactivityTimer(ws, stream); // Reset timer after sending silence
    }
  };

  