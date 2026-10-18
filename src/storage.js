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
  const data = (await readJSON(HISTORY_FILE)) || [];
  return data.filter(item => item?.uri && !item.uri.includes('8081') && !item.uri.startsWith('exp://'));
};

export const saveToHistory = async (pdfObj) => {
  if (!pdfObj?.uri || pdfObj.uri.includes('8081') || pdfObj.uri.startsWith('exp://')) return;
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
  const data = (await readJSON(FAVORITES_FILE)) || [];
  return data.filter(item => item?.uri && !item.uri.includes('8081') && !item.uri.startsWith('exp://'));
};

export const addToFavorites = async (pdfObj) => {
  if (!pdfObj?.uri || pdfObj.uri.includes('8081') || pdfObj.uri.startsWith('exp://')) return;
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
  const session = await readJSON(SESSION_FILE);
  if (session?.uri && (session.uri.includes('8081') || session.uri.startsWith('exp://'))) {
    await setLastSession(null);
    return null;
  }
  return session;
};

export const setLastSession = async (sessionData) => {
  if (!sessionData || sessionData.uri?.includes('8081') || sessionData.uri?.startsWith('exp://')) {
    try { await FileSystem.deleteAsync(SESSION_FILE, { idempotent: true }); } catch {}
  } else {
    await writeJSON(SESSION_FILE, sessionData);
  }
};
