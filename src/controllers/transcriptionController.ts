
import { TranscribeStreamingClient, StartStreamTranscriptionCommand, ItemType } from '@aws-sdk/client-transcribe-streaming';
import { streams } from '../types/stream';
import WebSocket from 'ws';
import { CustomWebSocket } from '../types/customWebSocket';
import { TranslationService } from '../services/translation/translationService';
import { SourceLangCode, TargetLangCode } from '../common/types/supportedLanguageCodes';

export const startTranscription = (ws: CustomWebSocket, streamID: string, language?: TargetLangCode) => {
  const stream = streams.get(streamID);
  if (!stream) {
    console.error('Stream not found for startTranscription');
    return;
  }

  const audioStream = stream.audioStream!;

  const onClose = () => {
    console.log('WebSocket closed, ending audio stream');
    audioStream.end();
  };

  const onError = (err: Error) => {
    console.error('WebSocket error:', err);
    audioStream.end();
  };

  ws.on('close', onClose);
  ws.on('error', onError);

  stream.listenerCleanup = () => {
    ws.off('close', onClose);
    ws.off('error', onError);
  };

  const controller = new AbortController();
  const abortSignal = controller.signal;
  stream.abortController = controller;

  async function* getAudioStream() {
    for await (const chunk of audioStream) {
      yield { AudioEvent: { AudioChunk: chunk } };
    }
  }


  const sourceLanguageCode: SourceLangCode = 'en-US';
  const targetLanguageCode: TargetLangCode = language ?? 'en-US';
  const translationService = new TranslationService();

  (async () => {
    const command = new StartStreamTranscriptionCommand({
      LanguageCode: sourceLanguageCode,
      MediaEncoding: 'pcm',
      MediaSampleRateHertz: 44100,
      AudioStream: getAudioStream(),
      EnablePartialResultsStabilization: true,
      PartialResultsStability: 'high',
      VocabularyName: process.env.CUSTOM_VOCABULARY_NAME,
    });
    try {
      const response = await new TranscribeStreamingClient({
        region: process.env.AWS_REGION!,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        },
      }).send(command, { abortSignal });
      let previousLastItemIndex = 0;
      let lastTranslatedChunk = '';
      for await (const event of response.TranscriptResultStream!) {
        if (!stream.isTranscribing) break;
        if (event.TranscriptEvent?.Transcript?.Results?.length) {
          const result = event.TranscriptEvent.Transcript.Results[0];
          if (result.Alternatives?.length) {
            const transcript = result.Alternatives[0].Transcript;
            if (sourceLanguageCode === targetLanguageCode) {
              console.log("transcript without translation:", transcript)
              sendTranscriptToClients(transcript!, result.IsPartial ?? false);
            }
            // Buffer partial transcripts
            else if (result.IsPartial) {
              const items = result.Alternatives[0].Items || [];
              const lastItemIndex = items.length - 1;
              const lastItem = items[lastItemIndex];

              if(lastItem?.Type === ItemType.PUNCTUATION) { 
                console.log("transcript:", transcript)
                const translatedTranscript = await translationService.translate(
                  transcript!,
                  sourceLanguageCode,
                  targetLanguageCode,
                  lastTranslatedChunk
                );
                lastTranslatedChunk = transcript!
                previousLastItemIndex = lastItemIndex;
                sendTranscriptToClients(translatedTranscript, true);
              }      
            } 
            else {
              const translatedTranscript = await translationService.translate(
                transcript!,
                sourceLanguageCode,
                targetLanguageCode,
                lastTranslatedChunk
              );
              sendTranscriptToClients(translatedTranscript, false);
            }
          }
        }
      }

      // Function to send transcripts to clients
      function sendTranscriptToClients(translatedTranscript: string, isPartial: boolean) {
        const message = JSON.stringify({
          type: 'transcript',
          transcript: translatedTranscript,
          isPartial,
          streamID,
        });

        for (const subscriber of stream!.subscribers) {
          if (subscriber.readyState === WebSocket.OPEN) {
            subscriber.send(message);
          }
        }

        if (stream!.audioSource?.readyState === WebSocket.OPEN) {
          stream!.audioSource.send(message);
        }
      }

      console.log('Transcription session ended');
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        console.log('Transcription aborted');
      } else {
        console.error('Transcribe client error:', err);
      }
    } finally {
      stream.listenerCleanup?.();
      stream.listenerCleanup = null;
      stream.audioStream?.end();
      stream.audioStream?.on('finish', () => {
        stream.audioStream = null;
      });
    }
  })();
};

// Function to send transcripts to clients
