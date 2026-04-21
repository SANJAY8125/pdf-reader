import NetInfo from '@react-native-community/netinfo';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';

const GEMINI_API_KEY = Constants.expoConfig?.extra?.GEMINI_API_KEY || Constants.manifest?.extra?.GEMINI_API_KEY;

// Memory caches
let dictCacheMemory = null;
let aiCacheMemory = null;
let memoryDictionary = null; // Lazy loaded offline dictionary

const DICT_CACHE_KEY = '@dict_cache';
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

// Cache init
const initCache = async () => {
  if (aiCacheMemory === null) {
    try {
      const data = await AsyncStorage.getItem(AI_CACHE_KEY);
      aiCacheMemory = data ? JSON.parse(data) : {};
    } catch { aiCacheMemory = {}; }
  }
  if (dictCacheMemory === null) {
    try {
      const data = await AsyncStorage.getItem(DICT_CACHE_KEY);
      dictCacheMemory = data ? JSON.parse(data) : {};
    } catch { dictCacheMemory = {}; }
  }
};

const saveCache = async (key, cacheObj) => {
  try {
    const keys = Object.keys(cacheObj);
    if (keys.length > MAX_CACHE_SIZE) {
      // Very simple LRU approach: drop oldest
      const toDelete = keys.slice(0, keys.length - MAX_CACHE_SIZE);
      toDelete.forEach(k => delete cacheObj[k]);
    }
    await AsyncStorage.setItem(key, JSON.stringify(cacheObj));
  } catch (err) {
    console.error('AsyncStorage save error', err);
  }
};

// Simple rule-based lemmatizer to normalize inflected words before dictionary lookup
const IRREGULAR_VERBS = {
  // Past tense irregulars
  went: 'go', gone: 'go',
  ran: 'run', run: 'run',
  was: 'be', were: 'be', been: 'be', am: 'be', is: 'be', are: 'be',
  had: 'have', has: 'have',
  did: 'do', done: 'do',
  said: 'say', told: 'tell',
  saw: 'see', seen: 'see',
  came: 'come', come: 'come',
  took: 'take', taken: 'take',
  got: 'get', gotten: 'get',
  made: 'make', knew: 'know', known: 'know',
  thought: 'think', brought: 'bring',
  bought: 'buy', caught: 'catch',
  taught: 'teach', sought: 'seek',
  found: 'find', kept: 'keep',
  left: 'leave', felt: 'feel',
  met: 'meet', sent: 'send',
  spent: 'spend', built: 'build',
  lost: 'lose', won: 'win',
  sat: 'sit', stood: 'stand',
  gave: 'give', given: 'give',
  wrote: 'write', written: 'write',
  spoke: 'speak', spoken: 'speak',
  chose: 'choose', chosen: 'choose',
  broke: 'break', broken: 'break',
  drove: 'drive', driven: 'drive',
  flew: 'fly', flown: 'fly',
  grew: 'grow', grown: 'grow',
  wore: 'wear', worn: 'wear',
  bore: 'bear', born: 'bear',
  led: 'lead', read: 'read',
  held: 'hold', sold: 'sell',
  told: 'tell', fell: 'fall', fallen: 'fall',
};

const lemmatize = (word) => {
  if (!word) return word;
  const w = word.toLowerCase();

  // Check irregular first
  if (IRREGULAR_VERBS[w]) return IRREGULAR_VERBS[w];

  // -ing → remove to get base (e.g. running→run, making→make)
  if (w.length > 5 && w.endsWith('ing')) {
    const stem = w.slice(0, -3);
    // doubled consonant: running → run
    if (stem.length > 2 && stem[stem.length - 1] === stem[stem.length - 2]) {
      return stem.slice(0, -1);
    }
    return stem.endsWith('e') ? stem : stem; // making → make is already handled by dict
  }

  // -ed → base form
  if (w.length > 4 && w.endsWith('ed')) {
    const stem = w.slice(0, -2);
    // doubled consonant: stopped → stop
    if (stem.length > 2 && stem[stem.length - 1] === stem[stem.length - 2]) {
      return stem.slice(0, -1);
    }
    // loved → love (ends with e after removing d)
    if (w.endsWith('ed') && !w.endsWith('eed')) {
      return stem;
    }
  }

  // -s / -es suffix (plurals & 3rd person singular)
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y'; // tries → try
  if (w.length > 4 && w.endsWith('es') && !w.endsWith('oes')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);

  return w;
};

export const lookupWord = async (word) => {
  const cleanWord = word.trim().toLowerCase().replace(/[^a-z]/g, '');
  if (!cleanWord) return "No text selected.";

  // Normalize to base form
  const baseWord = lemmatize(cleanWord);

  await initCache();
  // Check cache for both forms
  if (dictCacheMemory[cleanWord]) return dictCacheMemory[cleanWord];
  if (baseWord !== cleanWord && dictCacheMemory[baseWord]) return dictCacheMemory[baseWord];

  let result = "No definition found. Try AI explanation.";
  const dict = await getDictionary();

  // Try original word first, then lemmatized base
  const entry = (dict && dict[cleanWord]) || (dict && dict[baseWord]);
  if (entry) {
    result = entry.replace(/(?:\s+|^)(\d+\.)\s/g, '\n$1 ').trim();
  }

  dictCacheMemory[baseWord] = result;
  saveCache(DICT_CACHE_KEY, dictCacheMemory); // fire and forget

  return result;
};

export const explainWithAI = async (text, contextText = "") => {
  if (!text.trim()) throw new Error("No text selected.");
  
  await initCache();
  const cacheKey = `${text}_${contextText}`;
  if (aiCacheMemory[cacheKey]) {
    return aiCacheMemory[cacheKey];
  }

  if (!GEMINI_API_KEY) {
    throw new Error("Gemini API key is missing. Please configure it in app.json or app.config.js (extra).");
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
    
    aiCacheMemory[cacheKey] = explanation;
    saveCache(AI_CACHE_KEY, aiCacheMemory); // fire and forget
    
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
