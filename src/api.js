import NetInfo from '@react-native-community/netinfo';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';

const GEMINI_API_KEY = Constants.expoConfig?.extra?.GEMINI_API_KEY || Constants.manifest?.extra?.GEMINI_API_KEY || process.env.EXPO_PUBLIC_GEMINI_API_KEY;

// Memory caches
const dictCache = new Map();
let memoryDictionary = null; // Lazy loaded offline dictionary

const AI_CACHE_KEY = '@ai_explanations_cache';
const MAX_CACHE_SIZE = 100; // Limit AsyncStorage cache items

// Dictionary loader
const getDictionary = async () => {
  if (memoryDictionary) return memoryDictionary;
  try {
    const asset = Asset.fromModule(require('../assets/dictionary.data'));
    await asset.downloadAsync();
    const uri = asset.localUri || asset.uri;
    const raw = await FileSystem.readAsStringAsync(uri);
    memoryDictionary = JSON.parse(raw);
    return memoryDictionary;
  } catch (err) {
    console.error("Dictionary load error:", err);
    return null;
  }
};

export const lookupWord = async (word) => {
  const cleanWord = word.trim().toLowerCase().replace(/[^a-z0-9]/gi, '');
  if (!cleanWord) return "No text selected.";
  
  if (dictCache.has(cleanWord)) {
    return dictCache.get(cleanWord);
  }

  let result = "No definition found. Try AI explanation.";
  const dict = await getDictionary();

  if (dict && dict[cleanWord]) {
    let rawMeaning = dict[cleanWord];
    let formatted = rawMeaning.replace(/(?:\s+|^)(\d+\.)\s/g, '\n$1 ').trim();
    const parts = formatted.split('\n');
    result = parts[0].replace(/^\d+\.\s*/, '').trim();
  }
  
  // LRU cache limit for memory dict cache
  if (dictCache.size >= 500) {
    const firstKey = dictCache.keys().next().value;
    dictCache.delete(firstKey);
  }
  
  dictCache.set(cleanWord, result);
  return result;
};

// AsyncStorage Cache helpers
const getAiCache = async () => {
  try {
    const data = await AsyncStorage.getItem(AI_CACHE_KEY);
    return data ? JSON.parse(data) : {};
  } catch {
    return {};
  }
};

const saveAiCache = async (cacheObj) => {
  try {
    const keys = Object.keys(cacheObj);
    if (keys.length > MAX_CACHE_SIZE) {
      // Very simple LRU approach: drop oldest
      const toDelete = keys.slice(0, keys.length - MAX_CACHE_SIZE);
      toDelete.forEach(k => delete cacheObj[k]);
    }
    await AsyncStorage.setItem(AI_CACHE_KEY, JSON.stringify(cacheObj));
  } catch (err) {
    console.error('AsyncStorage save error', err);
  }
};

export const explainWithAI = async (text, contextText = "") => {
  if (!text.trim()) throw new Error("No text selected.");
  
  const cacheKey = `${text}_${contextText}`;
  const localCache = await getAiCache();
  if (localCache[cacheKey]) {
    return localCache[cacheKey];
  }

  if (!GEMINI_API_KEY) {
    throw new Error("Gemini API key is missing. Please configure it in app.json (extra) or .env.");
  }

  // Optimize context to precisely surrounding sentences
  let trimmedContext = "";
  if (contextText && text) {
    const sentences = contextText.split(/(?<=[.?!])\s+/);
    const targetIdx = sentences.findIndex(s => s.includes(text));
    
    if (targetIdx !== -1) {
      const startIdx = Math.max(0, targetIdx - 1);
      const endIdx = Math.min(sentences.length, targetIdx + 2);
      trimmedContext = sentences.slice(startIdx, endIdx).join(' ');
    } else {
      const textIndex = contextText.indexOf(text);
      if (textIndex !== -1) {
        const pre = contextText.substring(Math.max(0, textIndex - 150), textIndex);
        const post = contextText.substring(textIndex + text.length, textIndex + text.length + 150);
        trimmedContext = `${pre}${text}${post}`;
      } else {
        trimmedContext = contextText.slice(0, 300);
      }
    }
  }

  const prompt = `Explain the exact meaning of the following text very concisely (1-2 lines maximum).
Use the optionally provided context to infer the correct context-specific meaning.
Text to explain: "${text}"
Surrounding Context: "${trimmedContext}"`;

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
    
    localCache[cacheKey] = explanation;
    await saveAiCache(localCache);
    
    return explanation;
  } catch (error) {
    console.error("AI Explanation Error:", error);
    if (!await checkNetwork()) {
         throw new Error("Network request failed. Please check your internet connection.");
    }
    if (error.message === 'busy') {
      throw new Error("AI service is currently busy. Please try again later.");
    }
    throw new Error("Failed to get AI explanation. Please try again.");
  }
};

export const checkNetwork = async () => {
  try {
    const state = await NetInfo.fetch();
    return state.isConnected && state.isInternetReachable !== false;
  } catch {
    return false;
  }
};
