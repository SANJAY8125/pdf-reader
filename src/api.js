import NetInfo from '@react-native-community/netinfo';
import dictionary from '../assets/dictionary.json';

const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY;

// Memory caches
const dictCache = new Map();
const aiCache = new Map();

export const lookupWord = async (word) => {
  const cleanWord = word.trim().toLowerCase().replace(/[^a-z0-9]/gi, '');
  
  if (dictCache.has(cleanWord)) {
    return dictCache.get(cleanWord);
  }

  let result = "Meaning not found in offline dictionary.";
  if (dictionary[cleanWord]) {
    let rawMeaning = dictionary[cleanWord];
    // Split on numbers e.g. "1. " or just generic lines
    let formatted = rawMeaning.replace(/(?:\s+|^)(\d+\.)\s/g, '\n$1 ').trim();
    
    // Grabe ONLY the first line definition for absolute brevity
    const parts = formatted.split('\n');
    result = parts[0].replace(/^\d+\.\s*/, '').trim();
  }
  
  dictCache.set(cleanWord, result);
  return result;
};

export const explainWithAI = async (text, contextText = "") => {
  const cacheKey = `${text}_${contextText}`;
  if (aiCache.has(cacheKey)) {
    return aiCache.get(cacheKey);
  }

  if (!GEMINI_API_KEY) {
    throw new Error("Gemini API key is missing.");
  }

  const prompt = `Explain the exact meaning of the following text very concisely (1-2 lines maximum).
Use the optionally provided context to infer the correct context-specific meaning.
Text to explain: "${text}"
Surrounding Context: "${contextText}"`;

  const makeRequest = async (retries) => {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
          }),
        }
      );

      if (!response.ok) {
        if (response.status >= 500 || response.status === 429) {
          throw new Error('busy');
        }
        throw new Error(`API error: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      if (retries > 0 && (error.message === 'busy' || error.name === 'TypeError')) {
        await new Promise(r => setTimeout(r, 1500)); // wait 1.5s before retry
        return makeRequest(retries - 1);
      }
      throw error;
    }
  };

  try {
    const data = await makeRequest(2); // up to 2 retries
    const explanation = data.candidates[0].content.parts[0].text;
    
    aiCache.set(cacheKey, explanation);
    return explanation;
  } catch (error) {
    console.error("AI Explanation Error:", error);
    if (error.message === 'busy') {
      throw new Error("AI service is currently busy. Please try again.");
    } else if (error.name === 'TypeError') {
      throw new Error("Network request failed. Please check your connection.");
    }
    throw new Error("Failed to get AI explanation. Please try again.");
  }
};

export const checkNetwork = async () => {
  const state = await NetInfo.fetch();
  return state.isConnected && state.isInternetReachable !== false;
};
