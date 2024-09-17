
import { TranscribeStreamingClient, StartStreamTranscriptionCommand } from '@aws-sdk/client-transcribe-streaming';
import { streams } from '../types/stream';
import WebSocket from 'ws';
import { CustomWebSocket } from '../types/customWebSocket';
import { initializeNewAudioStream } from './streamController';
import { TranslationService } from '../services/translation/translationService';
import { TranscriptionMessage } from '../common/types/transcriptionMessage';
import { SupportedSourceLanguageCode, SupportedTargetLanguageCode } from '../common/types/supportedLanguageCodes';

export const startTranscription = (ws: CustomWebSocket, streamID: string) => {
  const stream = streams.get(streamID);
  if (!stream) {
    console.error('Stream not found for startTranscription');
    return;
  }

  if (stream.audioStream) {
    stream.audioStream.removeAllListeners();
    stream.audioStream = null;
  }
  if (stream.abortController) {
    stream.abortController.abort();
    stream.abortController = null;
  }

  initializeNewAudioStream(stream);
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


  const sourceLanguageCode: SupportedSourceLanguageCode = 'en-US';
  const targetLanguageCode: SupportedTargetLanguageCode = 'et-EE';
  const translationService = new TranslationService();

  (async () => {
    const command = new StartStreamTranscriptionCommand({
      LanguageCode: sourceLanguageCode,
      MediaEncoding: 'pcm',
      MediaSampleRateHertz: 44100,
      AudioStream: getAudioStream(),
    });
    try {
      const response = await new TranscribeStreamingClient({
        region: process.env.AWS_REGION!,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        },
      }).send(command, { abortSignal });
      let partialTranslatedTranscript = '';
      let partialTranscript = '';
      for await (const event of response.TranscriptResultStream!) {
        if (!stream.isTranscribing) break;
        if (event.TranscriptEvent?.Transcript?.Results?.length) {
          const result = event.TranscriptEvent.Transcript.Results[0];
          if (result.Alternatives?.length) {
            const transcript = result.Alternatives[0].Transcript;
            let translatedTranscript = undefined;
            if(!result.IsPartial && partialTranscript) {
              translatedTranscript = await translationService.translate(partialTranscript!, sourceLanguageCode, targetLanguageCode, partialTranslatedTranscript);
              partialTranscript = '';
            }
            else {
              partialTranscript = transcript!;
              //partialTranslatedTranscript = await translationService.translate(transcript!, sourceLanguageCode, targetLanguageCode, partialTranslatedTranscript);
            }
            // else {
            //   translatedTranscript = await translationService.translate(transcript!, sourceLanguageCode, destinationLanguageCode, );
            // }
            console.log(result.IsPartial ? "Partial" : "Final", "Transcript: ", transcript, "\nTranslated transcript: ", translatedTranscript);
            const messageJson: TranscriptionMessage = {
              type: 'transcript',
              sourceLanguageCode: sourceLanguageCode,
              destinationLanguageCode: targetLanguageCode,
              transcript: translatedTranscript ?? transcript!,
              isPartial: result.IsPartial ?? false,
              streamID,
            }
            const message = JSON.stringify(messageJson);

            for (const subscriber of stream.subscribers) {
              if (subscriber.readyState === WebSocket.OPEN && !result.IsPartial) {
                subscriber.send(message);
              }
            }

            if (stream.audioSource?.readyState === WebSocket.OPEN && !result.IsPartial) {
              stream.audioSource.send(message);
            }
          }
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
