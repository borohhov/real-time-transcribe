import { TranslationProvider } from "../translationProvider";
import axios from "axios";

export class OpenAIProvider implements TranslationProvider {


  async translate(text: string, sourceLang: string = 'en-US', targetLang: string = 'et-EE', context?: string): Promise<string> {
    const correctionPrompt = 'Never output any explanation or reasoning. If the sentence is illogical, guess the context, i.e. "Sunday without a cherry" might be an incorrect translation for "Sundae without a cherry".';
    let prompt = `Translate the following text from ${sourceLang} to ${targetLang}. ${correctionPrompt}`;
    if(context) {
      prompt = `Translate the following text from ${sourceLang} to ${targetLang}. You are translating live subtitles that get updated every few seconds. Try not to change previously translated chunks. Previous chunk: ${context} ${correctionPrompt}`;
    }
    try {
      const response = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: prompt,
            },
            {
              role: "user",
              content: text,
            },
          ],
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      const translatedText = response.data.choices[0].message.content.trim();
      return translatedText;
    } catch (error) {
      console.error("Error translating text with OpenAI:", error);
      throw new Error("Translation failed");
    }
  }
}