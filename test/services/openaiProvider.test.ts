import axios from 'axios';
import { OpenAIProvider } from '../../src/services/translation/openai/openaiProvider';
import { captureAiGenerationEvent } from '../../src/services/analytics/posthogClient';

jest.mock('axios', () => ({
  post: jest.fn(),
  isAxiosError: jest.fn(),
}));

jest.mock('../../src/services/analytics/posthogClient', () => ({
  captureAiGenerationEvent: jest.fn(),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const captureEventMock = captureAiGenerationEvent as jest.Mock;
const axiosIsAxiosErrorMock = axios.isAxiosError as unknown as jest.Mock;
let dateNowSpy: jest.SpyInstance<number, []>;

describe('OpenAIProvider', () => {
  beforeEach(() => {
    mockedAxios.post.mockReset();
    axiosIsAxiosErrorMock.mockReturnValue(false);
    captureEventMock.mockClear();
    process.env.OPENAI_API_KEY = 'unit-test-key';
    dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000);
  });

  afterEach(() => {
    dateNowSpy.mockRestore();
  });

  it('sends chat completions requests and records analytics on success', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        id: 'cmpl-123',
        model: 'gpt-5-nano',
        choices: [
          {
            message: {
              role: 'assistant',
              content: ' translated output ',
            },
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      },
      status: 200,
    });

    const provider = new OpenAIProvider();
    const result = await provider.translate('Hi', 'en-US', 'lv-LV', 'previous', {
      streamID: 'stream-1',
      traceID: 'trace-1',
      sessionID: 'session-1',
    });

    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({
        model: 'gpt-5-nano',
        messages: [
          expect.objectContaining({ role: 'system', content: expect.stringContaining('previous') }),
          { role: 'user', content: 'Hi' },
        ],
      }),
      {
        headers: {
          Authorization: 'Bearer unit-test-key',
          'Content-Type': 'application/json',
        },
      }
    );
    expect(result).toBe('translated output');
    expect(captureEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openai',
        model: 'gpt-5-nano',
        metadata: expect.objectContaining({
          targetLanguage: 'lv-LV',
          streamID: 'stream-1',
          translationContext: 'previous',
        }),
      })
    );
  });

  it('reports analytics and throws when OpenAI returns an error', async () => {
    const error = {
      response: {
        status: 429,
        data: {
          usage: {
            prompt_tokens: 5,
            completion_tokens: 1,
            total_tokens: 6,
          },
        },
      },
    };
    mockedAxios.post.mockRejectedValue(error);
    axiosIsAxiosErrorMock.mockReturnValue(true);

    const provider = new OpenAIProvider();
    await expect(
      provider.translate('Hello', 'en-US', 'et-EE', undefined, { streamID: 'stream-2' })
    ).rejects.toThrow('Translation failed');

    expect(captureEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        isError: true,
        httpStatus: 429,
        metadata: expect.objectContaining({ targetLanguage: 'et-EE', streamID: 'stream-2' }),
      })
    );
  });
});
