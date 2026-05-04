import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity, SafeAreaView,
  ActivityIndicator, ScrollView, FlatList, Image,
  BackHandler, StatusBar as RNStatusBar, Platform, Animated,
  Modal, Share, ActionSheetIOS,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as DocumentPicker from 'expo-document-picker';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import { BookOpen, Brain, WifiOff, X, ChevronLeft, Plus, Clock, Moon, Sun, Smartphone, Monitor, Star, MoreVertical } from 'lucide-react-native';
import PdfViewer from './src/PdfViewer';
import { checkNetwork, explainWithAI, lookupWord } from './src/api';
import {
  getHistory, saveToHistory, removeFromHistory,
  getFavorites, addToFavorites, removeFromFavorites, isFavorite,
  saveThumbnail, getThumbnailPath,
  getLastSession, setLastSession
} from './src/storage';
import * as ScreenOrientation from 'expo-screen-orientation';

const SCREEN_HOME = 'home';
const SCREEN_READER = 'reader';
const TAB_RECENT = 'recent';
const TAB_FAVORITES = 'favorites';

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
  if (!name) return 'Unknown file';
  return name.replace(/\.(pdf|docx|doc)$/i, '');
}

const STATUSBAR_HEIGHT = Platform.OS === 'android' ? RNStatusBar.currentHeight || 24 : 0;

export default function App() {
  const [screen, setScreen] = useState(SCREEN_HOME);
  const [history, setHistory] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [activeTab, setActiveTab] = useState(TAB_RECENT);
  const [activePdf, setActivePdf] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [currentScrollY, setCurrentScrollY] = useState(0);
  const [isOnline, setIsOnline] = useState(true);
  const [isAppReady, setIsAppReady] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isLandscape, setIsLandscape] = useState(false);
  const [thumbnails, setThumbnails] = useState({});

  // Three-dot menu
  const [menuVisible, setMenuVisible] = useState(false);
  const [menuItem, setMenuItem] = useState(null);
  const [menuIsFav, setMenuIsFav] = useState(false);

  // AI Modal
  const [modalVisible, setModalVisible] = useState(false);
  const [resultTitle, setResultTitle] = useState('');
  const [resultContent, setResultContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [refineContext, setRefineContext] = useState(null);
  const slideAnim = useRef(new Animated.Value(1000)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const [showHeader, setShowHeader] = useState(false);
  const [copyToast, setCopyToast] = useState(false);
  const copyToastTimer = useRef(null);

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
    ]).start(() => { setModalVisible(false); setRefineContext(null); });
  };

  // Load thumbnails for a list of items
  const loadThumbnails = useCallback(async (items) => {
    const thumbMap = {};
    for (const item of items) {
      const path = getThumbnailPath(item.uri);
      try {
        const info = await FileSystem.getInfoAsync(path);
        if (info.exists) thumbMap[item.uri] = path;
      } catch {}
    }
    setThumbnails(prev => ({ ...prev, ...thumbMap }));
  }, []);

  useEffect(() => {
    async function init() {
      checkNetwork().then(setIsOnline);
      const hist = await getHistory();
      const favs = await getFavorites();
      setHistory(hist);
      setFavorites(favs);
      loadThumbnails([...hist, ...favs]);

      const session = await getLastSession();
      if (session?.uri) {
        setActivePdf({
          uri: session.uri,
          name: session.name,
          initialPage: session.lastPage || 1,
          startScrollY: session.scrollY || 0,
          fileType: session.fileType || 'pdf',
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
      if (menuVisible) { setMenuVisible(false); return true; }
      if (screen === SCREEN_READER) { goHome(); return true; }
      return false;
    });
    return () => handler.remove();
  }, [screen, menuVisible]);

  const refreshLists = useCallback(async () => {
    const hist = await getHistory();
    const favs = await getFavorites();
    setHistory(hist);
    setFavorites(favs);
    loadThumbnails([...hist, ...favs]);
  }, [loadThumbnails]);

  const openFile = useCallback(async (entry) => {
    const fileEntry = {
      uri: entry.uri,
      name: entry.name,
      initialPage: entry.lastPage || 1,
      startScrollY: entry.scrollY || 0,
      fileType: entry.fileType || 'pdf',
    };
    setActivePdf(fileEntry);
    setCurrentPage(fileEntry.initialPage);
    setCurrentScrollY(fileEntry.startScrollY);
    setTotalPages(entry.totalPages || 0);
    setScreen(SCREEN_READER);
    setShowHeader(false);
    await setLastSession({
      uri: entry.uri,
      name: entry.name,
      lastPage: fileEntry.initialPage,
      totalPages: entry.totalPages || 0,
      scrollY: fileEntry.startScrollY,
      fileType: fileEntry.fileType,
    });
  }, []);

  const goHome = useCallback(async () => {
    setScreen(SCREEN_HOME);
    setShowHeader(false);
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    setIsLandscape(false);
    await refreshLists();
  }, [refreshLists]);

  const pickDocument = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword'],
        copyToCacheDirectory: true,
      });
      if (result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const isDocx = asset.name?.toLowerCase().endsWith('.docx') || asset.name?.toLowerCase().endsWith('.doc');
        const pdfEntry = {
          uri: asset.uri,
          name: asset.name || 'Unknown file',
          lastPage: 1,
          scrollY: 0,
          totalPages: 0,
          lastAccessed: Date.now(),
          fileType: isDocx ? 'docx' : 'pdf',
        };
        await saveToHistory(pdfEntry);
        openFile(pdfEntry);
      }
    } catch (err) {
      console.log('Document pick error:', err);
    }
  }, [openFile]);

  const onProgress = useCallback(async ({ page, scrollY, totalPages: tp, thumbnail }) => {
    if (thumbnail && activePdf?.uri) {
      handleThumbnail(thumbnail, activePdf.uri);
      return;
    }
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
      fileType: activePdf.fileType || 'pdf',
    };
    await saveToHistory(updatedEntry);
    await setLastSession(updatedEntry);
  }, [activePdf, currentPage, totalPages, currentScrollY]);

  // Handle thumbnail posted from WebView
  const handleThumbnail = useCallback(async (base64, uri) => {
    const path = await saveThumbnail(uri, base64);
    if (path) setThumbnails(prev => ({ ...prev, [uri]: path + '?t=' + Date.now() }));
  }, []);

  const handleCopy = useCallback(async (text) => {
    try { await Clipboard.setStringAsync(text); } catch (e) {}
    clearTimeout(copyToastTimer.current);
    setCopyToast(true);
    copyToastTimer.current = setTimeout(() => setCopyToast(false), 2000);
  }, []);

  const handleAction = useCallback(async (actionType, text, contextText) => {
    if (actionType === 'tap') { setShowHeader(prev => !prev); return; }
    setRefineContext(null);
    if (actionType === 'dict') {
      await handleDictionary(text, contextText, true);
    } else {
      await handleExplain(text, contextText);
    }
  }, []);

  const handleExplain = async (text, contextText) => {
    openModal(); setIsLoading(true); setResultTitle(text); setRefineContext(null);
    const online = await checkNetwork(); setIsOnline(online);
    try {
      const res = await explainWithAI(text, contextText);
      setResultContent(res);
    } catch (error) { setResultContent(error.message || 'Could not fetch explanation.'); }
    setIsLoading(false);
  };

  const handleDictionary = async (text, contextText, canRefine) => {
    openModal(); setIsLoading(true);
    const firstWord = text.split(/[ \n]/)[0].replace(/[^a-zA-Z]/g, '');
    setResultTitle(firstWord || 'Dictionary');
    try {
      const meaning = await lookupWord(firstWord);
      setResultContent(meaning);
    } catch (error) { setResultContent(error.message || 'Could not fetch dictionary.'); }
    if (canRefine) setRefineContext({ text: firstWord, contextText });
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

  const openMenu = useCallback(async (item) => {
    const fav = await isFavorite(item.uri);
    setMenuIsFav(fav);
    setMenuItem(item);
    setMenuVisible(true);
  }, []);

  const handleMenuAction = useCallback(async (action) => {
    setMenuVisible(false);
    if (!menuItem) return;
    if (action === 'remove') {
      await removeFromHistory(menuItem.uri);
      await refreshLists();
    } else if (action === 'favorite') {
      await addToFavorites(menuItem);
      await refreshLists();
    } else if (action === 'unfavorite') {
      await removeFromFavorites(menuItem.uri);
      await refreshLists();
    } else if (action === 'share') {
      try {
        await Share.share({ url: menuItem.uri, message: menuItem.name });
      } catch {}
    }
  }, [menuItem, refreshLists]);

  // Handle messages from WebView including thumbnail
  const handleMessage = useCallback((event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'thumbnail' && activePdf?.uri) {
        handleThumbnail(data.data, activePdf.uri);
      }
      // Pass to existing handler logic below
      return data;
    } catch {}
  }, [activePdf, handleThumbnail]);

  const displayList = activeTab === TAB_RECENT ? history : favorites;

  const renderItem = ({ item }) => {
    const thumbUri = thumbnails[item.uri];
    const isDocx = item.fileType === 'docx';
    return (
      <TouchableOpacity style={styles.card} onPress={() => openFile(item)} activeOpacity={0.7}>
        <View style={styles.thumbContainer}>
          {thumbUri && !isDocx ? (
            <Image source={{ uri: thumbUri }} style={styles.thumb} resizeMode="cover" />
          ) : (
            <View style={[styles.thumb, styles.thumbPlaceholder]}>
              <Text style={styles.thumbExt}>{isDocx ? 'DOC' : 'PDF'}</Text>
            </View>
          )}
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.cardName} numberOfLines={2}>{getFilename(item.name)}</Text>
          <View style={styles.cardMeta}>
            <BookOpen color="#525870" size={11} />
            <Text style={styles.cardTime}>Page {item.lastPage || 1}</Text>
            <Text style={styles.cardDot}>•</Text>
            <Clock color="#525870" size={11} />
            <Text style={styles.cardTime}>{formatDate(item.lastAccessed)}</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.menuBtn} onPress={() => openMenu(item)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <MoreVertical color="#525870" size={20} />
        </TouchableOpacity>
      </TouchableOpacity>
    );
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
      <View style={[styles.container, { paddingTop: STATUSBAR_HEIGHT }]}>
        <StatusBar style="light" />

        {/* Header */}
        <View style={styles.homeHeader}>
          <Text style={styles.homeTitle}>Files</Text>
        </View>

        {/* Tabs */}
        <View style={styles.tabRow}>
          <TouchableOpacity
            style={[styles.tab, activeTab === TAB_RECENT && styles.tabActive]}
            onPress={() => setActiveTab(TAB_RECENT)}
          >
            <Text style={[styles.tabText, activeTab === TAB_RECENT && styles.tabTextActive]}>Recent</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === TAB_FAVORITES && styles.tabActive]}
            onPress={() => setActiveTab(TAB_FAVORITES)}
          >
            <Text style={[styles.tabText, activeTab === TAB_FAVORITES && styles.tabTextActive]}>Favorites</Text>
          </TouchableOpacity>
        </View>

        {displayList.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>{activeTab === TAB_RECENT ? 'No recent files' : 'No favorites yet'}</Text>
            <Text style={styles.emptySubtitle}>
              {activeTab === TAB_RECENT ? 'Tap + to open a PDF or Word document' : 'Open a file and tap ··· to favorite it'}
            </Text>
          </View>
        ) : (
          <FlatList
            data={displayList}
            keyExtractor={(item) => item.uri}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            renderItem={renderItem}
          />
        )}

        <TouchableOpacity style={styles.fab} onPress={pickDocument} activeOpacity={0.85}>
          <Plus color="#FFF" size={28} />
        </TouchableOpacity>

        {/* Three-dot menu modal */}
        <Modal transparent visible={menuVisible} animationType="fade" onRequestClose={() => setMenuVisible(false)}>
          <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setMenuVisible(false)}>
            <View style={styles.menuSheet}>
              <Text style={styles.menuTitle} numberOfLines={1}>{getFilename(menuItem?.name)}</Text>
              <TouchableOpacity style={styles.menuOption} onPress={() => handleMenuAction(menuIsFav ? 'unfavorite' : 'favorite')}>
                <Star color={menuIsFav ? '#F59E0B' : '#A0AABF'} size={18} fill={menuIsFav ? '#F59E0B' : 'none'} />
                <Text style={styles.menuOptionText}>{menuIsFav ? 'Unfavorite' : 'Favorite'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.menuOption} onPress={() => handleMenuAction('share')}>
                <Text style={styles.menuOptionIcon}>↑</Text>
                <Text style={styles.menuOptionText}>Share</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.menuOption} onPress={() => handleMenuAction('remove')}>
                <Text style={[styles.menuOptionIcon, { color: '#FF5252' }]}>✕</Text>
                <Text style={[styles.menuOptionText, { color: '#FF5252' }]}>Remove</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>
      </View>
    );
  }

  // Reader screen
  return (
    <View style={styles.container}>
      <StatusBar style="light" hidden={!showHeader} />
      <PdfViewer
        uri={activePdf?.uri}
        initialPage={activePdf?.initialPage || 1}
        startScrollY={activePdf?.startScrollY || 0}
        isDarkMode={isDarkMode}
        fileType={activePdf?.fileType || 'pdf'}
        onAction={handleAction}
        onCopy={handleCopy}
        onProgress={onProgress}
        onMessage={(event) => {
          const data = handleMessage(event);
          // existing message handling already in PdfViewer
        }}
      />

      {showHeader && (
        <View style={[styles.readerHeader, { paddingTop: STATUSBAR_HEIGHT + 12 }]}>
          <TouchableOpacity onPress={goHome} style={styles.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <ChevronLeft color="#FFF" size={26} />
          </TouchableOpacity>
          <Text style={styles.readerTitle} numberOfLines={1}>{getFilename(activePdf?.name)}</Text>
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
          <Text style={styles.pageIndicator}>{currentPage} / {totalPages}</Text>
        </View>
      )}

      {modalVisible && (
        <View style={styles.customModalContainer}>
          <Animated.View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.65)', opacity: fadeAnim }]}>
            <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={closeModal} />
          </Animated.View>
          <Animated.View style={[styles.bottomSheet, isLandscape && styles.bottomSheetLandscape, { transform: [{ translateY: slideAnim }], flexShrink: 1 }]}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{resultTitle.charAt(0).toUpperCase() + resultTitle.slice(1)}</Text>
              <TouchableOpacity onPress={closeModal} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <X color="#6B7280" size={22} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ flex: 1, minHeight: 60 }} contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator nestedScrollEnabled keyboardShouldPersistTaps="handled">
              {isLoading ? (
                <View style={styles.loadingBox}>
                  <ActivityIndicator color="#4B7BFF" size="large" />
                  <Text style={styles.loadingLabel}>Analyzing...</Text>
                </View>
              ) : (
                <View>
                  <Text style={styles.resultText}>{resultContent}</Text>
                  {refineContext && (
                    <TouchableOpacity style={styles.refineBtn} onPress={() => handleExplain(refineContext.text, refineContext.contextText)}>
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
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1C1F2A',
    backgroundColor: '#111318',
  },
  homeTitle: { fontSize: 20, fontWeight: '700', color: '#FFF' },

  tabRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 4,
    gap: 8,
    backgroundColor: '#111318',
  },
  tab: {
    paddingHorizontal: 20, paddingVertical: 8,
    borderRadius: 20, backgroundColor: '#1C1F2A',
  },
  tabActive: { backgroundColor: '#4B7BFF' },
  tabText: { color: '#6B7280', fontSize: 14, fontWeight: '600' },
  tabTextActive: { color: '#FFF' },

  listContent: { padding: 16, gap: 12 },
  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#151820', borderRadius: 16,
    padding: 12, borderWidth: 1, borderColor: '#1E2231', gap: 12,
  },
  thumbContainer: { width: 56, height: 72, borderRadius: 8, overflow: 'hidden' },
  thumb: { width: 56, height: 72, borderRadius: 8 },
  thumbPlaceholder: {
    backgroundColor: '#1A2040', justifyContent: 'center', alignItems: 'center',
  },
  thumbExt: { color: '#4B7BFF', fontSize: 11, fontWeight: '700' },
  cardBody: { flex: 1 },
  cardName: { color: '#F0F2FF', fontSize: 15, fontWeight: '600', marginBottom: 6 },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cardTime: { color: '#525870', fontSize: 11 },
  cardDot: { color: '#2C2F40', marginHorizontal: 2 },
  menuBtn: { padding: 4 },

  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  emptyTitle: { color: '#E0E4FF', fontSize: 20, fontWeight: '700', marginBottom: 8 },
  emptySubtitle: { color: '#525870', fontSize: 14, textAlign: 'center', lineHeight: 22 },

  fab: {
    position: 'absolute', bottom: 28, right: 24,
    backgroundColor: '#4B7BFF', width: 60, height: 60, borderRadius: 30,
    justifyContent: 'center', alignItems: 'center',
    elevation: 10, shadowColor: '#4B7BFF', shadowOpacity: 0.4, shadowRadius: 12,
  },

  menuOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  menuSheet: {
    backgroundColor: '#151820', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, paddingBottom: 36,
  },
  menuTitle: { color: '#A0AABF', fontSize: 13, marginBottom: 16, fontWeight: '500' },
  menuOption: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 14, borderTopWidth: 1, borderTopColor: '#1E2231',
  },
  menuOptionIcon: { color: '#A0AABF', fontSize: 18, width: 20, textAlign: 'center' },
  menuOptionText: { color: '#E0E4FF', fontSize: 16, fontWeight: '500' },

  readerHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 12, paddingBottom: 14,
    backgroundColor: 'rgba(17, 19, 24, 0.95)',
    borderBottomWidth: 1, borderBottomColor: '#1C1F2A',
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100,
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

  customModalContainer: { ...StyleSheet.absoluteFillObject, zIndex: 9999, justifyContent: 'flex-end' },
  bottomSheet: {
    backgroundColor: '#151820', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, maxHeight: '80%', minHeight: '40%', flex: 0,
  },
  bottomSheetLandscape: { maxHeight: '70%', minHeight: '50%' },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
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
