import { GoogleGenAI, ThinkingLevel, Modality, Type, GenerateContentResponse } from "@google/genai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// For models that require user-provided API keys (Veo, Gemini 3 Pro Image)
// We'll use process.env.API_KEY which is injected by the platform after selection
const getApiKey = () => process.env.API_KEY || GEMINI_API_KEY;

export const analyzeVideo = async (videoBase64: string, prompt: string) => {
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: [
      {
        inlineData: {
          mimeType: "video/mp4",
          data: videoBase64,
        },
      },
      { text: prompt },
    ],
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
    },
  });
  return response.text;
};

export const analyzeImage = async (imageBase64: string, prompt: string, mimeType: string = "image/jpeg") => {
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: [
      {
        inlineData: {
          mimeType,
          data: imageBase64,
        },
      },
      { text: prompt },
    ],
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
    },
  });
  return response.text;
};

export const chatWithGemini = async (messages: { role: 'user' | 'model', content: string }[], systemInstruction: string) => {
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  const chat = ai.chats.create({
    model: "gemini-3.1-pro-preview",
    config: {
      systemInstruction,
      thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
    },
  });

  // Send all previous messages except the last one to build history
  // Actually, chat.sendMessage only accepts the message parameter.
  // To maintain history, we should use the chat object correctly.
  
  let lastResponse: GenerateContentResponse | null = null;
  for (let i = 0; i < messages.length; i++) {
    lastResponse = await chat.sendMessage({ message: messages[i].content });
  }
  
  return lastResponse?.text;
};

export const generateImage = async (prompt: string, aspectRatio: string = "1:1", quality: 'standard' | 'pro' = 'standard') => {
  const apiKey = getApiKey();
  const ai = new GoogleGenAI({ apiKey });
  const model = quality === 'pro' ? 'gemini-3-pro-image-preview' : 'gemini-3.1-flash-image-preview';
  
  const response = await ai.models.generateContent({
    model,
    contents: {
      parts: [{ text: prompt }],
    },
    config: {
      imageConfig: {
        aspectRatio: aspectRatio as any,
        imageSize: "1K"
      },
    },
  });

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return `data:image/png;base64,${part.inlineData.data}`;
    }
  }
  return null;
};

export const generateVideo = async (prompt: string, imageBase64?: string, aspectRatio: '16:9' | '9:16' = '16:9') => {
  const apiKey = getApiKey();
  const ai = new GoogleGenAI({ apiKey });
  
  let operation = await ai.models.generateVideos({
    model: 'veo-3.1-fast-generate-preview',
    prompt,
    image: imageBase64 ? {
      imageBytes: imageBase64,
      mimeType: 'image/png',
    } : undefined,
    config: {
      numberOfVideos: 1,
      resolution: '1080p',
      aspectRatio
    }
  });

  while (!operation.done) {
    await new Promise(resolve => setTimeout(resolve, 10000));
    operation = await ai.operations.getVideosOperation({ operation: operation });
  }

  const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
  if (!downloadLink) return null;

  const response = await fetch(downloadLink, {
    method: 'GET',
    headers: {
      'x-goog-api-key': apiKey!,
    },
  });
  
  const blob = await response.blob();
  return URL.createObjectURL(blob);
};

export const searchGrounding = async (query: string) => {
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: query,
    config: {
      tools: [{ googleSearch: {} }],
    },
  });
  
  return {
    text: response.text,
    sources: response.candidates?.[0]?.groundingMetadata?.groundingChunks?.map((chunk: any) => chunk.web) || []
  };
};

export const mapsGrounding = async (query: string, location?: { latitude: number, longitude: number }) => {
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: query,
    config: {
      tools: [{ googleMaps: {} }],
      toolConfig: location ? {
        retrievalConfig: {
          latLng: location
        }
      } : undefined
    },
  });
  
  return {
    text: response.text,
    sources: response.candidates?.[0]?.groundingMetadata?.groundingChunks?.map((chunk: any) => chunk.maps) || []
  };
};

export const fastResponse = async (prompt: string) => {
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-3.1-flash-lite-preview",
    contents: prompt,
  });
  return response.text;
};
