import * as FileSystem from 'expo-file-system/legacy';

const HISTORY_FILE = FileSystem.documentDirectory + 'pdf_history.json';
const SESSION_FILE = FileSystem.documentDirectory + 'pdf_session.json';
const FAVORITES_FILE = FileSystem.documentDirectory + 'pdf_favorites.json';

async function readJSON(path) {
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    const raw = await FileSystem.readAsStringAsync(path);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeJSON(path, data) {
  try {
    await FileSystem.writeAsStringAsync(path, JSON.stringify(data));
  } catch (err) {
    console.error('writeJSON error:', err);
  }
}

export const getHistory = async () => {
  return (await readJSON(HISTORY_FILE)) || [];
};

export const saveToHistory = async (pdfObj) => {
  const history = await getHistory();
  const idx = history.findIndex(item => item.uri === pdfObj.uri);
  const entry = { ...pdfObj, lastAccessed: Date.now() };
  if (idx >= 0) {
    history[idx] = { ...history[idx], ...entry };
  } else {
    history.unshift(entry);
  }
  await writeJSON(HISTORY_FILE, history.slice(0, 20));
};

export const removeFromHistory = async (uri) => {
  const history = await getHistory();
  const updated = history.filter(item => item.uri !== uri);
  await writeJSON(HISTORY_FILE, updated);
};

export const getFavorites = async () => {
  return (await readJSON(FAVORITES_FILE)) || [];
};

export const addToFavorites = async (pdfObj) => {
  const favs = await getFavorites();
  const exists = favs.find(item => item.uri === pdfObj.uri);
  if (!exists) {
    favs.unshift(pdfObj);
    await writeJSON(FAVORITES_FILE, favs);
  }
};

export const removeFromFavorites = async (uri) => {
  const favs = await getFavorites();
  const updated = favs.filter(item => item.uri !== uri);
  await writeJSON(FAVORITES_FILE, updated);
};

export const isFavorite = async (uri) => {
  const favs = await getFavorites();
  return favs.some(item => item.uri === uri);
};

export const saveThumbnail = async (uri, base64Png) => {
  try {
    const key = uri.replace(/[^a-zA-Z0-9]/g, '_');
    const thumbPath = FileSystem.documentDirectory + 'thumb_' + key + '.png';
    await FileSystem.writeAsStringAsync(thumbPath, base64Png, { encoding: 'base64' });
    return thumbPath;
  } catch {
    return null;
  }
};

export const getThumbnailPath = (uri) => {
  const key = uri.replace(/[^a-zA-Z0-9]/g, '_');
  return FileSystem.documentDirectory + 'thumb_' + key + '.png';
};

export const getLastSession = async () => {
  return await readJSON(SESSION_FILE);
};

export const setLastSession = async (sessionData) => {
  if (!sessionData) {
    try { await FileSystem.deleteAsync(SESSION_FILE, { idempotent: true }); } catch {}
  } else {
    await writeJSON(SESSION_FILE, sessionData);
  }
};
