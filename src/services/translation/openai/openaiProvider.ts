import { TranslationProvider } from "../translationProvider";
import axios from "axios";

export class OpenAIProvider implements TranslationProvider {


  async translate(text: string, sourceLang: string = 'en-US', targetLang: string = 'et-EE', context?: string): Promise<string> {
    let prompt = `Translate the following text from ${sourceLang} to ${targetLang}.`;
    if(context) {
      prompt = `Translate the following text from ${sourceLang} to ${targetLang}. You are translating live subtitles that get updated every few seconds. Do not translate the same word twice. Previous translation: ${context}`;
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