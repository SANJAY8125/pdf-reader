import * as FileSystem from 'expo-file-system/legacy';

const HISTORY_FILE = FileSystem.documentDirectory + 'pdf_history.json';
const SESSION_FILE = FileSystem.documentDirectory + 'pdf_session.json';

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
  await writeJSON(HISTORY_FILE, history.slice(0, 20)); // Keep last 20
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
