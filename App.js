import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity, SafeAreaView,
  ActivityIndicator, ScrollView, FlatList,
  BackHandler, StatusBar as RNStatusBar, Platform, Animated, useWindowDimensions
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as DocumentPicker from 'expo-document-picker';
import * as Clipboard from 'expo-clipboard';
import { BookOpen, FileText, Brain, WifiOff, X, ChevronLeft, Plus, Clock, Moon, Sun, Smartphone, Monitor } from 'lucide-react-native';
import PdfViewer from './src/PdfViewer';
import { checkNetwork, explainWithAI, lookupWord } from './src/api';
import { getHistory, saveToHistory, getLastSession, setLastSession } from './src/storage';
import * as ScreenOrientation from 'expo-screen-orientation';

const SCREEN_HOME = 'home';
const SCREEN_READER = 'reader';

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString();
}

function getFilename(name) {
  if (!name) return 'Unknown PDF';
  return name.replace(/\.pdf$/i, '');
}

const STATUSBAR_HEIGHT = Platform.OS === 'android' ? RNStatusBar.currentHeight || 24 : 0;

// Simple rule-based lemmatizer for dictionary lookups
function lemmatize(word) {
  const w = word.toLowerCase().trim();
  const irregulars = {
    went: 'go', gone: 'go', goes: 'go',
    ran: 'run', runs: 'run',
    was: 'be', were: 'be', been: 'be', is: 'be', are: 'be',
    had: 'have', has: 'have',
    did: 'do', does: 'do', done: 'do',
    said: 'say', says: 'say',
    got: 'get', gotten: 'get', gets: 'get',
    made: 'make', makes: 'make',
    knew: 'know', known: 'know', knows: 'know',
    came: 'come', comes: 'come',
    took: 'take', taken: 'take', takes: 'take',
    saw: 'see', seen: 'see', sees: 'see',
    thought: 'think', thinks: 'think',
    bought: 'buy', buys: 'buy',
    brought: 'bring', brings: 'bring',
    felt: 'feel', feels: 'feel',
    left: 'leave', leaves: 'leave',
    kept: 'keep', keeps: 'keep',
    told: 'tell', tells: 'tell',
    found: 'find', finds: 'find',
    gave: 'give', given: 'give', gives: 'give',
    met: 'meet', meets: 'meet',
    lost: 'lose', loses: 'lose',
    led: 'lead', leads: 'lead',
    read: 'read', reads: 'read',
  };
  if (irregulars[w]) return irregulars[w];
  // Remove simple suffixes
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 4 && w.endsWith('ed')) {
    // doubled consonant e.g. stopped → stop
    if (w[w.length - 3] === w[w.length - 4]) return w.slice(0, -3);
    return w.slice(0, -2);
  }
  if (w.length > 3 && w.endsWith('es')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

export default function App() {
  const [screen, setScreen] = useState(SCREEN_HOME);
  const [history, setHistory] = useState([]);
  const [activePdf, setActivePdf] = useState(null); // { uri, name, initialPage, scrollY }
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [currentScrollY, setCurrentScrollY] = useState(0);
  
  const [isOnline, setIsOnline] = useState(true);
  const [isAppReady, setIsAppReady] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isLandscape, setIsLandscape] = useState(false);
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const isLandscapeNow = winWidth > winHeight;

  // AI Modal
  const [modalVisible, setModalVisible] = useState(false);
  const [resultTitle, setResultTitle] = useState('');
  const [resultContent, setResultContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [refineContext, setRefineContext] = useState(null);
  
  const slideAnim = useRef(new Animated.Value(1000)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current; 
  
  const openModal = () => {
    setModalVisible(true);
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, tension: 70, friction: 12, useNativeDriver: true })
    ]).start();
  };

  const closeModal = () => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 1000, duration: 200, useNativeDriver: true })
    ]).start(() => {
      setModalVisible(false);
      setRefineContext(null);
    });
  };

  const [showHeader, setShowHeader] = useState(false);
  const [copyToast, setCopyToast] = useState(false);
  const copyToastTimer = useRef(null);

  useEffect(() => {
    async function init() {
      checkNetwork().then(setIsOnline);
      const hist = await getHistory();
      setHistory(hist);

      const session = await getLastSession();
      if (session?.uri) {
        setActivePdf({ 
          uri: session.uri, 
          name: session.name, 
          initialPage: session.lastPage || 1,
          startScrollY: session.scrollY || 0 
        });
        setCurrentPage(session.lastPage || 1);
        setCurrentScrollY(session.scrollY || 0);
        setTotalPages(session.totalPages || 0);
        setScreen(SCREEN_READER);
      }
      setIsAppReady(true);
    }
    init();
  }, []);

  useEffect(() => {
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (screen === SCREEN_READER) {
        goHome();
        return true;
      }
      return false;
    });
    return () => handler.remove();
  }, [screen]);

  const openPdf = useCallback(async (pdfEntry) => {
    const entry = {
      uri: pdfEntry.uri,
      name: pdfEntry.name,
      initialPage: pdfEntry.lastPage || 1,
      startScrollY: pdfEntry.scrollY || 0,
    };
    setActivePdf(entry);
    setCurrentPage(entry.initialPage);
    setCurrentScrollY(entry.startScrollY);
    setTotalPages(pdfEntry.totalPages || 0);
    setScreen(SCREEN_READER);
    setShowHeader(false);

    await setLastSession({
      uri: pdfEntry.uri,
      name: pdfEntry.name,
      lastPage: entry.initialPage,
      totalPages: pdfEntry.totalPages || 0,
      scrollY: entry.startScrollY,
    });
  }, []);

  const goHome = useCallback(async () => {
    setScreen(SCREEN_HOME);
    setShowHeader(false);
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    setIsLandscape(false);
    const hist = await getHistory();
    setHistory(hist);
  }, []);

  const pickDocument = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
      });
      if (result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const pdfEntry = {
          uri: asset.uri,
          name: asset.name || 'Unknown PDF',
          lastPage: 1,
          scrollY: 0,
          totalPages: 0,
          lastAccessed: Date.now(),
        };
        await saveToHistory(pdfEntry);
        openPdf(pdfEntry);
      }
    } catch (err) {
      console.log('Document pick error:', err);
    }
  }, [openPdf]);

  const onProgress = useCallback(async ({ page, scrollY, totalPages: tp }) => {
    if (!activePdf) return;
    if (tp) setTotalPages(tp);
    if (page) setCurrentPage(page);
    if (scrollY !== undefined) setCurrentScrollY(scrollY);

    const updatedEntry = {
      uri: activePdf.uri,
      name: activePdf.name,
      lastPage: page || currentPage,
      totalPages: tp || totalPages,
      scrollY: scrollY !== undefined ? scrollY : currentScrollY,
    };
    await saveToHistory(updatedEntry);
    await setLastSession(updatedEntry);
  }, [activePdf, currentPage, totalPages, currentScrollY]);

  const handleCopy = useCallback(async (text) => {
    try { await Clipboard.setStringAsync(text); } catch (e) {}
    clearTimeout(copyToastTimer.current);
    setCopyToast(true);
    copyToastTimer.current = setTimeout(() => setCopyToast(false), 2000);
  }, []);

  const handleAction = useCallback(async (actionType, text, contextText) => {
    if (actionType === 'tap') {
      setShowHeader(prev => !prev);
      return;
    }
    setRefineContext(null);
    if (actionType === 'dict') {
      await handleDictionary(text, contextText, true);
    } else {
      await handleExplain(text, contextText);
    }
  }, []);

  const handleExplain = async (text, contextText) => {
    openModal();
    setIsLoading(true);
    setResultTitle(text);
    setRefineContext(null);
    const online = await checkNetwork();
    setIsOnline(online);
    
    try {
      const res = await explainWithAI(text, contextText);
      setResultContent(res);
    } catch (error) {
       setResultContent(error.message || 'Could not fetch explanation.');
    }
    setIsLoading(false);
  };

  const handleDictionary = async (text, contextText, canRefine) => {
    openModal();
    setIsLoading(true);
    const rawWord = text.split(/[ \n]/)[0].replace(/[^a-zA-Z]/g, '');
    const baseWord = lemmatize(rawWord); // normalize to base form
    setResultTitle(baseWord || 'Dictionary');
    try {
      const meaning = await lookupWord(baseWord);
      setResultContent(meaning);
    } catch (error) {
      setResultContent(error.message || 'Could not fetch dictionary.');
    }
    if (canRefine) setRefineContext({ text: baseWord, contextText });
    setIsLoading(false);
  };

  const toggleOrientation = async () => {
    if (isLandscape) {
      await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
      setIsLandscape(false);
    } else {
      await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE_RIGHT);
      setIsLandscape(true);
    }
  };

  if (!isAppReady) {
    return (
      <View style={styles.splash}>
        <BookOpen color="#4B7BFF" size={48} />
        <Text style={styles.splashTitle}>PDF AI Reader</Text>
        <ActivityIndicator color="#4B7BFF" style={{ marginTop: 24 }} />
      </View>
    );
  }

  if (screen === SCREEN_HOME) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style="light" hidden={false} />
        <View style={styles.homeHeader}>
          <BookOpen color="#4B7BFF" size={22} />
          <Text style={styles.homeTitle}>PDF AI Reader</Text>
          {!isOnline && (
            <View style={styles.offlinePill}>
              <WifiOff color="#FF5252" size={12} />
              <Text style={styles.offlineText}>Offline</Text>
            </View>
          )}
        </View>

        {history.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <FileText color="#3A3F4F" size={52} />
            </View>
            <Text style={styles.emptyTitle}>No PDFs opened yet</Text>
            <Text style={styles.emptySubtitle}>Tap the + button to open your first PDF</Text>
          </View>
        ) : (
          <FlatList
            data={history}
            keyExtractor={(item) => item.uri}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.pdfCard} onPress={() => openPdf(item)} activeOpacity={0.7}>
                <View style={styles.cardIcon}>
                  <FileText color="#4B7BFF" size={26} />
                </View>
                <View style={styles.cardBody}>
                  <Text style={styles.cardName} numberOfLines={1}>
                    {getFilename(item.name)}
                  </Text>
                  <View style={styles.cardMeta}>
                    {item.lastAccessed && (
                      <View style={styles.cardTimeRow}>
                         <BookOpen color="#525870" size={11} />
                         <Text style={styles.cardTime}>Page {item.lastPage || 1}</Text>
                         <Text style={{color:'#2C2F40', marginHorizontal: 4}}>•</Text>
                         <Clock color="#525870" size={11} />
                         <Text style={styles.cardTime}>{formatDate(item.lastAccessed)}</Text>
                      </View>
                    )}
                  </View>
                </View>
              </TouchableOpacity>
            )}
          />
        )}

        <TouchableOpacity style={styles.fab} onPress={pickDocument} activeOpacity={0.85}>
          <Plus color="#FFF" size={28} />
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" hidden={!showHeader} />
      <PdfViewer
        uri={activePdf?.uri}
        initialPage={activePdf?.initialPage || 1}
        startScrollY={activePdf?.startScrollY || 0}
        isDarkMode={isDarkMode}
        onAction={handleAction}
        onCopy={handleCopy}
        onProgress={onProgress}
      />

      {showHeader && (
        <View style={[styles.readerHeader, { paddingTop: STATUSBAR_HEIGHT + 12 }]}>
          <TouchableOpacity onPress={goHome} style={styles.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <ChevronLeft color="#FFF" size={26} />
          </TouchableOpacity>
          <Text style={styles.readerTitle} numberOfLines={1}>
            {getFilename(activePdf?.name)}
          </Text>
          <TouchableOpacity onPress={() => setIsDarkMode(!isDarkMode)} style={styles.themeBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            {isDarkMode ? <Sun color="#FFF" size={20} /> : <Moon color="#FFF" size={20} />}
          </TouchableOpacity>
          <TouchableOpacity onPress={toggleOrientation} style={styles.themeBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            {isLandscape ? <Smartphone color="#FFF" size={20} /> : <Monitor color="#FFF" size={20} />}
          </TouchableOpacity>
        </View>
      )}

      {showHeader && totalPages > 0 && (
         <View pointerEvents="none" style={[styles.floatingPageNum, { top: STATUSBAR_HEIGHT + 70 }]}>
            <Text style={styles.pageIndicator}>
              {currentPage} / {totalPages}
            </Text>
         </View>
      )}

      {modalVisible && (
        <View style={styles.customModalContainer}>
          <Animated.View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.65)', opacity: fadeAnim }]}>
            <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={closeModal} />
          </Animated.View>
          
          <Animated.View style={[styles.bottomSheet, { transform: [{ translateY: slideAnim }], maxHeight: isLandscapeNow ? '50%' : '80%' }]}>
            {!isLandscapeNow && <View style={styles.sheetHandle} />}
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>
                {resultTitle.charAt(0).toUpperCase() + resultTitle.slice(1)}
              </Text>
              <TouchableOpacity onPress={closeModal} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <X color="#6B7280" size={22} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator>
              {isLoading ? (
                <View style={styles.loadingBox}>
                  <ActivityIndicator color="#4B7BFF" size="large" />
                  <Text style={styles.loadingLabel}>Analyzing...</Text>
                </View>
              ) : (
                <View style={{ paddingBottom: 40 }}>
                  <Text style={styles.resultText}>{resultContent}</Text>
                  {refineContext && (
                    <TouchableOpacity
                      style={styles.refineBtn}
                      onPress={() => handleExplain(refineContext.text, refineContext.contextText)}
                    >
                      <Brain color="#4B7BFF" size={15} />
                      <Text style={styles.refineBtnText}>Explain in this context (AI)</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </ScrollView>
          </Animated.View>
        </View>
      )}

      {copyToast && (
        <View style={styles.copyToast} pointerEvents="none">
          <Text style={styles.copyToastText}>✓ Copied!</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0C0E14' },
  splash: { flex: 1, backgroundColor: '#0C0E14', justifyContent: 'center', alignItems: 'center' },
  splashTitle: { color: '#FFF', fontSize: 24, fontWeight: '700', marginTop: 16, letterSpacing: 0.5 },
  homeHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 20, paddingVertical: 18,
    borderBottomWidth: 1, borderBottomColor: '#1C1F2A',
    backgroundColor: '#111318',
  },
  homeTitle: { flex: 1, fontSize: 20, fontWeight: '700', color: '#FFF', letterSpacing: 0.4 },
  offlinePill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#2D1A1A', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20,
  },
  offlineText: { color: '#FF5252', fontSize: 11, fontWeight: '600' },
  listContent: { padding: 16, gap: 12 },
  pdfCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#151820', borderRadius: 16,
    padding: 16, borderWidth: 1, borderColor: '#1E2231',
  },
  cardIcon: {
    width: 48, height: 48, borderRadius: 12,
    backgroundColor: '#1A2040', justifyContent: 'center', alignItems: 'center',
  },
  cardBody: { flex: 1 },
  cardName: { color: '#F0F2FF', fontSize: 15, fontWeight: '600', marginBottom: 5 },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  cardTimeRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  cardTime: { color: '#525870', fontSize: 11 },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  emptyIcon: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: '#151820', justifyContent: 'center', alignItems: 'center', marginBottom: 24,
  },
  emptyTitle: { color: '#E0E4FF', fontSize: 20, fontWeight: '700', marginBottom: 8 },
  emptySubtitle: { color: '#525870', fontSize: 14, textAlign: 'center', lineHeight: 22 },
  fab: {
    position: 'absolute', bottom: 28, right: 24,
    backgroundColor: '#4B7BFF', width: 60, height: 60, borderRadius: 30,
    justifyContent: 'center', alignItems: 'center',
    elevation: 10, shadowColor: '#4B7BFF', shadowOpacity: 0.4, shadowRadius: 12,
  },
  readerHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 12, paddingBottom: 14,
    backgroundColor: 'rgba(17, 19, 24, 0.95)',
    borderBottomWidth: 1, borderBottomColor: '#1C1F2A',
    position: 'absolute', top: 0, left: 0, right: 0,
    zIndex: 100,
  },
  backBtn: { padding: 4, width: 34, alignItems: 'center' },
  themeBtn: { padding: 4, width: 34, alignItems: 'center' },
  readerTitle: { flex: 1, color: '#F0F2FF', fontSize: 16, fontWeight: '700', textAlign: 'center' },
  floatingPageNum: {
    position: 'absolute', alignSelf: 'center',
    backgroundColor: 'rgba(30, 34, 49, 0.85)',
    paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: 14, zIndex: 99,
  },
  pageIndicator: { color: '#A0AABF', fontSize: 13, fontWeight: '600' },
  customModalContainer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999, justifyContent: 'flex-end',
  },
  bottomSheet: {
    backgroundColor: '#151820', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, maxHeight: '80%', minHeight: '35%',
  },
  sheetHandle: {
    width: 40, height: 4, backgroundColor: '#2C2F40',
    borderRadius: 2, alignSelf: 'center', marginBottom: 16,
  },
  sheetHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 16,
  },
  sheetTitle: { color: '#FFF', fontSize: 18, fontWeight: '700', flex: 1, marginRight: 12 },
  loadingBox: { paddingVertical: 40, alignItems: 'center' },
  loadingLabel: { color: '#6B7280', marginTop: 12, fontSize: 14 },
  resultText: { color: '#E0E4FF', fontSize: 16, lineHeight: 26 },
  refineBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: '#2A3A6A', backgroundColor: '#141E35',
    padding: 12, borderRadius: 10, marginTop: 16, justifyContent: 'center',
  },
  refineBtnText: { color: '#4B7BFF', fontSize: 14, fontWeight: '600' },
  copyToast: {
    position: 'absolute', top: 80, alignSelf: 'center',
    backgroundColor: 'rgba(75,123,255,0.92)',
    borderRadius: 20, paddingHorizontal: 18, paddingVertical: 8,
  },
  copyToastText: { color: '#FFF', fontSize: 14, fontWeight: '700', letterSpacing: 0.3 },
});
