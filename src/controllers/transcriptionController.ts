import {
  TranscribeStreamingClient,
  StartStreamTranscriptionCommand,
  ItemType,
} from '@aws-sdk/client-transcribe-streaming';
import { streams } from '../common/stream';
import WebSocket from 'ws';
import { CustomWebSocket } from '../common/customWebSocket';
import { TranslationService } from '../services/translation/translationService';
import { SourceLangCode, TargetLangCode } from '../common/supportedLanguageCodes';

export const startTranscription = (
  ws: CustomWebSocket,
  streamID: string,
  language?: TargetLangCode
) => {
  const stream = streams.get(streamID);
  if (!stream) {
    console.error('Stream not found for startTranscription');
    return;
  }

  const audioStream = stream.audioStream!;

  // WebSocket event handlers
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

  // Cleanup function for event listeners
  stream.listenerCleanup = () => {
    ws.off('close', onClose);
    ws.off('error', onError);
  };

  const controller = new AbortController();
  const abortSignal = controller.signal;
  stream.abortController = controller;

  // Async generator for audio chunks
  async function* getAudioStream() {
    for await (const chunk of audioStream) {
      yield { AudioEvent: { AudioChunk: chunk } };
    }
  }

  const subscribers = stream.subscribers;
  const audioSource = stream.audioSource;
  const shouldContinueTranscribing = () => stream.isTranscribing;

  // Function to send transcripts to clients
  const sendTranscript = (transcript: string, isPartial: boolean) => {
    const message = JSON.stringify({
      type: 'transcript',
      transcript,
      isPartial,
      streamID,
    });

    for (const subscriber of subscribers) {
      if (subscriber.readyState === WebSocket.OPEN) {
        subscriber.send(message);
      }
    }

    if (audioSource?.readyState === WebSocket.OPEN) {
      audioSource.send(message);
    }
  };

  // Start the transcription handling
  handleTranscription(
    getAudioStream,
    shouldContinueTranscribing,
    sendTranscript,
    language,
    abortSignal
  )
    .catch((err) => {
      if ((err as Error).name === 'AbortError') {
        console.log('Transcription aborted');
      } else {
        console.error('Transcribe client error:', err);
      }
    })
    .finally(() => {
      stream.listenerCleanup?.();
      stream.listenerCleanup = null;
      stream.audioStream?.end();
      stream.audioStream?.on('finish', () => {
        stream.audioStream = null;
      });
    });
};


async function handleTranscription(
  getAudioStream: () => AsyncGenerator<{ AudioEvent: { AudioChunk: Buffer } }>,
  shouldContinueTranscribing: () => boolean,
  sendTranscript: (transcript: string, isPartial: boolean) => void,
  language: TargetLangCode | undefined,
  abortSignal: AbortSignal
) {
  const sourceLanguageCode: SourceLangCode = 'en-US';
  const targetLanguageCode: TargetLangCode = language ?? 'en-US';
  const translationService = new TranslationService();

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
    const client = new TranscribeStreamingClient({
      region: process.env.AWS_REGION!,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });

    const response = await client.send(command, { abortSignal });
    const translationContext: TranslationContext = {
      untranslatedBuffer: '',
      previousItems: []
    };

    for await (const event of response.TranscriptResultStream!) {
      if (!shouldContinueTranscribing()) break;
  
      await processTranscriptEvent(
        event,
        sourceLanguageCode,
        targetLanguageCode,
        translationService,
        sendTranscript,
        translationContext
      );
    }

    console.log('Transcription session ended');
  } catch (err) {
    throw err;
  }
}

interface TranslationContext {
  previousItems: any[]; // Store previous items for comparison
  untranslatedBuffer: string; // Accumulates text to be translated
}

async function processTranscriptEvent(
  event: any,
  sourceLanguageCode: SourceLangCode,
  targetLanguageCode: TargetLangCode,
  translationService: TranslationService,
  sendTranscript: (transcript: string, isPartial: boolean) => void,
  translationContext: TranslationContext
) {
  if (event.TranscriptEvent?.Transcript?.Results?.length) {
    const result = event.TranscriptEvent.Transcript.Results[0];

    if (result.Alternatives?.length) {
      const items = result.Alternatives[0].Items || [];

      // For same-language transcripts
      if (sourceLanguageCode === targetLanguageCode) {
        const transcript = reconstructTranscript(items);
        sendTranscript(transcript, result.IsPartial ?? false);
        return;
      }

      // Compare current items with previous items to find new additions
      let startIndex = 0;
      const prevItems = translationContext.previousItems || [];
      while (
        startIndex < items.length &&
        startIndex < prevItems.length &&
        items[startIndex].Content === prevItems[startIndex].Content
      ) {
        startIndex++;
      }

      // Extract new items from the point where they differ
      const newItems = items.slice(startIndex);

      // Update the previousItems for the next comparison
      translationContext.previousItems = items;

      if (newItems.length > 0) {
        // Reconstruct new text with proper spacing
        const newText = reconstructTranscript(newItems);

        // Append new text to the untranslated buffer
        translationContext.untranslatedBuffer += newText;
      }

      const shouldTranslate = checkShouldTranslate(translationContext.untranslatedBuffer);

      if (shouldTranslate || !result.IsPartial) {
        // Translate the buffered text
        const translatedText = await translationService.translate(
          translationContext.untranslatedBuffer,
          sourceLanguageCode,
          targetLanguageCode,
          prevItems.join(' ')
        );

        // Send the translated text
        sendTranscript(translatedText, false);

        // Clear the untranslated buffer
        translationContext.untranslatedBuffer = '';
      }
    }
  }
}

// Helper function to reconstruct transcript with proper spacing
function reconstructTranscript(items: any[]): string {
  let transcript = '';
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const content = item.Content;
    const itemType = item.Type;

    if (itemType === 'pronunciation') {
      transcript += content;

      // Add a space after words if the next item is not punctuation
      const nextItem = items[i + 1];
      if (nextItem && nextItem.Type === 'pronunciation') {
        transcript += ' ';
      } else if (!nextItem) {
        // If it's the last item, add a space
        transcript += ' ';
      }
    } else if (itemType === 'punctuation') {
      transcript += content;
    }
  }
  return transcript.trim();
}

// Helper function to decide when to translate the buffered text
function checkShouldTranslate(buffer: string): boolean {
  // Check for sentence-ending punctuation
  const punctuationRegex = /[.!?。！？]/;
  if (punctuationRegex.test(buffer)) {
    return true;
  }

  // Check if word count exceeds threshold (e.g., 40 words)
  const words = buffer.trim().split(/\s+/);
  if (words.length >= 40) {
    return true;
  }

  return false;
}
