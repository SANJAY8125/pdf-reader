import React, { useRef, useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, ActivityIndicator, Text } from 'react-native';
import { WebView } from 'react-native-webview';
import * as FileSystem from 'expo-file-system/legacy';

const buildHtml = () => `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, minimum-scale=0.5, maximum-scale=4.0, user-scalable=yes">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js"></script>
  <style>
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      background-color: #E5E7EB;
      overflow-x: hidden;
      font-family: sans-serif;
      transition: background-color 0.3s;
    }
    #pdf-container {
      width: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      transition: filter 0.3s;
    }
    .page {
      width: 100%;
      margin-bottom: 4px;
      position: relative;
      background: #FFFFFF;
    }
    
    .page-placeholder {
      position: absolute;
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      color: #9CA3AF;
      font-size: 18px;
      font-weight: 600;
      pointer-events: none;
    }
    
    html::-webkit-scrollbar, body::-webkit-scrollbar { display: none; }
    
    #custom-scrollbar {
      position: fixed;
      right: 4px;
      top: 50%;
      transform: translateY(-50%);
      height: 80vh;
      width: 32px;
      pointer-events: none;
      z-index: 9999;
      display: none;
      opacity: 0;
      transition: opacity 0.3s;
    }
    #scroll-thumb {
      position: absolute;
      right: 0;
      top: 0;
      width: 28px;
      height: 54px;
      background: rgba(30, 33, 43, 0.9);
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 14px;
      pointer-events: auto;
      display: flex;
      justify-content: center;
      align-items: center;
      box-shadow: 0 4px 12px rgba(0,0,0,0.5);
    }
    #scroll-thumb:active { background: rgba(50, 55, 70, 0.95); }
    .thumb-dots { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3px; }
    .thumb-dot { width: 3px; height: 3px; background: #A0AABF; border-radius: 50%; }
    
    canvas { display: block; }
    .textLayer {
      position: absolute;
      left: 0; top: 0; right: 0; bottom: 0;
      overflow: hidden;
      opacity: 0.25;
      line-height: 1.0;
    }
    .textLayer > span {
      color: transparent;
      position: absolute;
      white-space: pre;
      cursor: text;
      transform-origin: 0% 0%;
    }
    ::selection { background: rgba(75, 123, 255, 0.4); color: transparent; }

    /* Floating AI toolbar */
    #ai-toolbar {
      display: none;
      position: fixed;
      z-index: 99999;
      background: #1C1F2E;
      border: 1px solid #2E3350;
      border-radius: 12px;
      padding: 6px 8px;
      flex-direction: row;
      gap: 4px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.7);
      pointer-events: auto;
      align-items: center;
    }
    .ai-btn {
      background: transparent;
      color: #fff;
      border: none;
      border-radius: 8px;
      width: 38px;
      height: 38px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 18px;
      transition: background 0.15s;
    }
    .ai-btn:active { background: rgba(75,123,255,0.25); }
    .ai-btn.copy  { color: #A0AABF; }
    .ai-btn.ai    { color: #4B7BFF; }
    .ai-btn.dict  { color: #C084FC; }
    .ai-divider { width: 1px; height: 22px; background: #2E3350; margin: 0 2px; }
  </style>
</head>
<body oncontextmenu="return false;">
  <div id="pdf-container"></div>
  <div id="custom-scrollbar">
    <div id="scroll-thumb">
      <div class="thumb-dots">
        <div class="thumb-dot"></div><div class="thumb-dot"></div><div class="thumb-dot"></div>
        <div class="thumb-dot"></div><div class="thumb-dot"></div><div class="thumb-dot"></div>
        <div class="thumb-dot"></div><div class="thumb-dot"></div><div class="thumb-dot"></div>
      </div>
    </div>
  </div>
  <div id="ai-toolbar">
    <button class="ai-btn copy" title="Copy" onmousedown="handleBtn(event,'copy')" ontouchstart="handleBtn(event,'copy')">&#x2398;</button>
    <div class="ai-divider"></div>
    <button class="ai-btn ai" title="AI Explain" onmousedown="handleBtn(event,'ai')" ontouchstart="handleBtn(event,'ai')">&#x2728;</button>
    <button class="ai-btn dict" title="Meaning" onmousedown="handleBtn(event,'dict')" ontouchstart="handleBtn(event,'dict')">&#x1F4D6;</button>
  </div>
  <script>
    function postRN(data) { window.ReactNativeWebView.postMessage(JSON.stringify(data)); }

    window.onerror = function(msg, src, line) { postRN({ type: 'log', message: 'Error: ' + msg + ' at ' + line }); };

    if (typeof pdfjsLib === 'undefined') {
      postRN({ type: 'log', message: 'pdfjsLib undefined - CDN failed!' });
    } else {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
      postRN({ type: 'ready' });
    }

    // Modern CSS Filter Dark Mode approach
    window.isDarkMode = false;
    window.setDarkMode = function(val) {
      if (window.isDarkMode === val) return;
      window.isDarkMode = val;
      const container = document.getElementById('pdf-container');
      if (!container) return;
      
      if (val) {
        document.body.style.backgroundColor = '#0C0E14';
        container.style.filter = 'invert(90%) hue-rotate(180deg) brightness(85%) contrast(90%)';
      } else {
        document.body.style.backgroundColor = '#E5E7EB';
        container.style.filter = 'none';
      }
    };

    let pdfDoc = null;
    let totalPages = 0;
    const container = document.getElementById('pdf-container');

    let lastReportedPage = 0;

    function getCurrentPage() {
      const viewportMid = window.scrollY + window.innerHeight / 2;
      const divs = container.querySelectorAll('.page');
      let best = 1, bestDist = Infinity;
      divs.forEach(div => {
        const mid = div.offsetTop + div.offsetHeight / 2;
        const dist = Math.abs(viewportMid - mid);
        if (dist < bestDist) {
          bestDist = dist;
          best = parseInt(div.dataset.pageNum, 10);
        }
      });
      return best;
    }

    const customScrollbar = document.getElementById('custom-scrollbar');
    const scrollThumb = document.getElementById('scroll-thumb');
    let isDraggingThumb = false, dragStartY = 0, dragStartProgress = 0, scrollbarHideTimer = null;

    function getScrollMax() { return document.documentElement.scrollHeight - window.innerHeight; }
    function getThumbMax() { return customScrollbar.clientHeight - scrollThumb.clientHeight; }

    function updateThumbPosition() {
      if (isDraggingThumb) return;
      const scrollMax = getScrollMax();
      if (scrollMax <= 0) { customScrollbar.style.display = 'none'; return; }
      customScrollbar.style.display = 'block';
      customScrollbar.style.opacity = '1';
      const progress = window.scrollY / scrollMax;
      scrollThumb.style.top = (progress * getThumbMax()) + 'px';
      clearTimeout(scrollbarHideTimer);
      scrollbarHideTimer = setTimeout(() => { if (!isDraggingThumb) customScrollbar.style.opacity = '0'; }, 1500);
    }

    scrollThumb.addEventListener('touchstart', (e) => {
      isDraggingThumb = true;
      dragStartY = e.touches[0].clientY;
      dragStartProgress = window.scrollY / getScrollMax();
      clearTimeout(scrollbarHideTimer);
      customScrollbar.style.opacity = '1';
      e.preventDefault();
    }, {passive: false});

    document.addEventListener('touchmove', (e) => {
      if (!isDraggingThumb) return;
      e.preventDefault();
      const deltaY = e.touches[0].clientY - dragStartY;
      let progress = dragStartProgress + (deltaY / getThumbMax());
      if (progress < 0) progress = 0; if (progress > 1) progress = 1;
      const targetPage = Math.round(progress * (totalPages - 1)) + 1;
      if (targetPage !== window._lastScrubPage) {
        window._lastScrubPage = targetPage;
        const div = container.querySelector('[data-page-num="' + targetPage + '"]');
        if (div) window.scrollTo(0, div.offsetTop);
      }
      scrollThumb.style.top = (progress * getThumbMax()) + 'px';
      checkAndReportProgress();
    }, {passive: false});

    document.addEventListener('touchend', () => {
      if (isDraggingThumb) {
        isDraggingThumb = false;
        scrollbarHideTimer = setTimeout(() => { customScrollbar.style.opacity = '0'; }, 1500);
      }
    });

    function checkAndReportProgress() {
      const pg = getCurrentPage();
      if (pg !== lastReportedPage) {
        lastReportedPage = pg;
        postRN({ type: 'progress', page: pg, scrollY: Math.round(window.scrollY) });
      }
    }

    let ticking = false;
    window.addEventListener('scroll', () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          updateThumbPosition();
          checkAndReportProgress();
          ticking = false;
        });
        ticking = true;
      }
    });

    // Handle Orientation Resize safely. Re-render pages if layout completely changed.
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const divs = container.querySelectorAll('.page');
        divs.forEach(div => {
           if (div.dataset.rendered) {
             div.dataset.rendered = '';
             div.innerHTML = '<div class="page-placeholder">Page ' + div.dataset.pageNum + '</div>';
             observer.observe(div);
           }
        });
      }, 200);
    });

    // ── Receive PDF data ──
    window.receivePdfData = async function(b64Data, initialPage, startInDarkMode, startScrollY) {
      try {
        window.isDarkMode = !!startInDarkMode;
        window.setDarkMode(window.isDarkMode);
        const binary = atob(b64Data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const task = pdfjsLib.getDocument({ data: bytes });
        pdfDoc = await task.promise;
        totalPages = pdfDoc.numPages;
        postRN({ type: 'total_pages', totalPages });
        container.innerHTML = '';
        container.style.justifyContent = totalPages === 1 ? 'center' : 'flex-start';
        await buildPlaceholders(initialPage || 1, startScrollY);
      } catch(e) {
        postRN({ type: 'log', message: 'receivePdfData error: ' + e.message });
      }
    };

    async function buildPlaceholders(initialPage, startScrollY) {
      try {
        const firstPage = await pdfDoc.getPage(1);
        const vp = firstPage.getViewport({ scale: 1 });
        const ratio = vp.height / vp.width;

        for (let i = 1; i <= pdfDoc.numPages; i++) {
          const div = document.createElement('div');
          div.className = 'page';
          div.dataset.pageNum = i;
          div.style.paddingTop = (ratio * 100) + '%'; 
          div.innerHTML = '<div class="page-placeholder">Page ' + i + '</div>';
          container.appendChild(div);
          observer.observe(div);
        }

        postRN({ type: 'done_loading' });

        requestAnimationFrame(() => {
          setTimeout(() => {
            if (startScrollY && startScrollY > 0) {
              window.scrollTo({ top: startScrollY, behavior: 'instant' });
            } else if (initialPage && initialPage > 1) {
              scrollToPage(initialPage);
            }
          }, 150);
        });
      } catch(e) {}
    }

    function scrollToPage(pageNum) {
      const div = container.querySelector('[data-page-num="' + pageNum + '"]');
      if (div) {
        div.scrollIntoView({ behavior: 'auto', block: 'start' });
        lastReportedPage = pageNum;
        postRN({ type: 'progress', page: pageNum, scrollY: Math.round(window.scrollY) });
      }
    }

    let renderQueue = new Set();
    let isRendering = false;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const num = parseInt(entry.target.dataset.pageNum, 10);
        if (entry.isIntersecting) {
          if (!entry.target.dataset.rendered) {
            renderQueue.add(num);
            processRenderQueue();
          }
        } else { renderQueue.delete(num); }
      });
    }, { root: null, rootMargin: '100% 0px' });

    async function processRenderQueue() {
      if (isRendering || renderQueue.size === 0) return;
      isRendering = true;
      while (renderQueue.size > 0) {
        const currentPg = getCurrentPage();
        let bestNum = -1, bestDist = Infinity;
        for (let num of renderQueue) {
          const dist = Math.abs(num - currentPg);
          if (dist < bestDist) { bestDist = dist; bestNum = num; }
        }
        if (bestNum === -1) break;
        renderQueue.delete(bestNum);
        const div = container.querySelector('[data-page-num="' + bestNum + '"]');
        if (div && !div.dataset.rendered) {
          div.dataset.rendered = 'true';
          await renderPage(bestNum, div);
        }
      }
      isRendering = false;
    }

    async function renderPage(num, div) {
      try {
        const page = await pdfDoc.getPage(num);
        const dpr = window.devicePixelRatio || 1;
        const naturalVp = page.getViewport({ scale: 1 });
        const cssScale = window.innerWidth / naturalVp.width;
        
        const cssViewport = page.getViewport({ scale: cssScale });
        const renderViewport = page.getViewport({ scale: cssScale * dpr });
        
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width  = renderViewport.width;
        canvas.height = renderViewport.height;
        canvas.style.position = 'absolute';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.width  = '100%';
        canvas.style.height = '100%';
        
        await page.render({ canvasContext: ctx, viewport: renderViewport }).promise;

        const textDiv = document.createElement('div');
        textDiv.className = 'textLayer';
        textDiv.style.width  = Math.round(cssViewport.width) + 'px';
        textDiv.style.height = Math.round(cssViewport.height) + 'px';
        
        // Ensure text layer scales with the absolute positioned responsive div!
        textDiv.style.position = 'absolute';
        textDiv.style.top = '0';
        textDiv.style.left = '0';
        textDiv.style.transform = 'scale(' + (window.innerWidth / Math.round(cssViewport.width)) + ')';
        textDiv.style.transformOrigin = '0 0';

        const textContent = await page.getTextContent();
        pdfjsLib.renderTextLayer({
          textContent,
          container: textDiv,
          viewport: cssViewport,
          textDivs: [],
          enhanceTextSelection: true
        });

        div.innerHTML = ''; 
        div.appendChild(canvas);
        div.appendChild(textDiv);
      } catch(e) {}
    }

    const toolbar = document.getElementById('ai-toolbar');

    function handleBtn(event, actionType) {
      event.preventDefault(); 
      event.stopPropagation();
      const sel = window.getSelection();
      const text = sel ? sel.toString().trim() : '';
      toolbar.style.display = 'none';
      if (text.length === 0) return;
      let ctx = '';
      if (sel.anchorNode && sel.anchorNode.parentElement) {
        let parent = sel.anchorNode.parentElement;
        if (parent.parentElement && parent.parentElement.classList.contains('textLayer')) {
           let children = Array.from(parent.parentElement.children);
           let idx = children.indexOf(parent);
           let start = Math.max(0, idx - 15);
           let end = Math.min(children.length, idx + 15);
           ctx = children.slice(start, end).map(n => n.textContent).join(' ');
        } else {
           ctx = parent.textContent;
        }
      }
      
      if (actionType === 'copy') {
        postRN({ type: 'copy_done', text });
      } else {
        postRN({ type: 'action', action: actionType, text, context: ctx });
      }
    }

    let toolbarTimer = null;
    document.addEventListener('selectionchange', () => {
      clearTimeout(toolbarTimer);
      const sel = window.getSelection();
      const text = sel ? sel.toString().trim() : '';

      if (text.length > 0 && sel.rangeCount > 0) {
        toolbarTimer = setTimeout(() => {
          const dictBtn = document.querySelector('.ai-btn.dict');
          if (dictBtn) {
            const hasSpace = text.indexOf(' ') !== -1 || text.indexOf('\\n') !== -1;
            dictBtn.style.display = hasSpace ? 'none' : 'flex';
          }
          const range = sel.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          toolbar.style.display = 'flex';
          let top = rect.top - toolbar.offsetHeight - 10;
          if (top < 8) top = rect.bottom + 10;
          let left = rect.left + rect.width / 2 - toolbar.offsetWidth / 2;
          if (left < 8) left = 8;
          if (left + toolbar.offsetWidth > window.innerWidth - 8) left = window.innerWidth - toolbar.offsetWidth - 8;
          toolbar.style.top = top + 'px';
          toolbar.style.left = left + 'px';
        }, 300);
      } else { toolbar.style.display = 'none'; }
    });

    document.addEventListener('click', (e) => {
      const sel = window.getSelection();
      if (!sel || sel.toString().trim().length === 0) postRN({ type: 'tap' });
    });

    document.addEventListener('scroll', () => { toolbar.style.display = 'none'; });
  </script>
</body>
</html>
`;

export default function PdfViewer({ uri, initialPage = 1, startScrollY = 0, isDarkMode = false, onAction, onCopy, onProgress }) {
  const webviewRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [statusText, setStatusText] = useState('Initializing...');
  const lastSelectedText = useRef('');
  const lastSelectedContext = useRef('');

  useEffect(() => {
    if (uri) {
      setLoading(true);
      setStatusText('Initializing...');
    }
  }, [uri]);

  const loadPdf = useCallback(async () => {
    try {
      setStatusText('Reading file...');
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
      setStatusText('Sending to viewer...');
      const script = \`
        try {
          window.receivePdfData("\${base64}", \${initialPage}, \${isDarkMode}, \${startScrollY});
        } catch(e) {}
        true;
      \`;
      webviewRef.current?.injectJavaScript(script);
    } catch (err) {
      setStatusText('Error: ' + err.message);
    }
  }, [uri, initialPage, startScrollY]); // Intentionally omitting isDarkMode to prevent complete reload during theme toggle

  useEffect(() => {
    if (!loading) {
      webviewRef.current?.injectJavaScript(\`
        if (typeof window.setDarkMode === 'function') {
          window.setDarkMode(\${isDarkMode});
        }
        true;
      \`);
    }
  }, [isDarkMode, loading]);

  const handleMessage = useCallback((event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'log') {
        setStatusText(data.message);
      } else if (data.type === 'ready') {
        if (uri) loadPdf();
      } else if (data.type === 'done_loading') {
        setLoading(false);
      } else if (data.type === 'total_pages') {
        if (onProgress) onProgress({ totalPages: data.totalPages });
      } else if (data.type === 'progress') {
        if (onProgress) onProgress({ page: data.page, scrollY: data.scrollY });
      } else if (data.type === 'action' && data.text) {
        if (onAction) onAction(data.action, data.text, data.context || '');
      } else if (data.type === 'copy_done' && data.text) {
        if (onCopy) onCopy(data.text);
      } else if (data.type === 'tap') {
        if (onAction) onAction('tap', '', '');
      }
    } catch (e) {}
  }, [uri, loadPdf, onProgress, onAction, onCopy]);

  return (
    <View style={styles.container}>
      {loading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#4B7BFF" />
          <Text style={styles.loadingText}>{statusText}</Text>
        </View>
      )}
      <WebView
        ref={webviewRef}
        originWhitelist={['*']}
        source={{ html: buildHtml() }}
        onMessage={handleMessage}
        javaScriptEnabled
        domStorageEnabled
        allowsFullscreenVideo={false}
        style={[styles.webview, loading && { width: 0, height: 0 }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },
  webview: { flex: 1, backgroundColor: 'transparent' },
  loadingContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#121212',
    zIndex: 10,
  },
  loadingText: {
    color: '#A0AABF',
    marginTop: 14,
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
});
