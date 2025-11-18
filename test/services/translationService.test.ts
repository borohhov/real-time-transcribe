import { TranslationService } from '../../src/services/translation/translationService';
import type { TranslationMetadata } from '../../src/services/translation/translationProvider';

const translateMock = jest.fn();

jest.mock('../../src/services/translation/openai/openaiProvider', () => ({
  OpenAIProvider: jest.fn().mockImplementation(() => ({
    translate: translateMock,
  })),
}));

describe('TranslationService', () => {
  beforeEach(() => {
    translateMock.mockReset();
  });

  it('delegates translations to the underlying provider', async () => {
    translateMock.mockResolvedValue('translated-text');
    const service = new TranslationService();
    const metadata: TranslationMetadata = { streamID: 'stream-1', traceID: 'trace' };

    const result = await service.translate('hello', 'en-US', 'lv-LV', 'context', metadata);

    expect(result).toBe('translated-text');
    expect(translateMock).toHaveBeenCalledWith('hello', 'en-US', 'lv-LV', 'context', metadata);
  });
});
