"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import ePub from 'epubjs';
import { ChevronLeft, ChevronRight, List, Loader2, PanelLeftClose } from 'lucide-react';

interface EpubViewerProps {
  fileData: any;
  theme: string;
  fontSize: number;
  fontFamily?: string;
  wordSpacing?: number;
  bookId: string;
  initialCfi?: string;
  onProgress?: (cfi: string) => void;
  onTextExtracted?: (text: string) => void;
}

type EpubThemeConfig = {
  bg: string;
  pageBg: string;
  text: string;
  muted: string;
  secondary: string;
  accent: string;
  selection: string;
  panelBorder: string;
  tocBg: string;
  tocActiveBg: string;
  inputBg: string;
};

const themeConfigs: Record<string, EpubThemeConfig> = {
  dark: {
    bg: '#0b0d10',
    pageBg: '#111418',
    text: '#e7e9ec',
    muted: '#788392',
    secondary: '#b8c0cc',
    accent: '#7dd3c7',
    selection: '#7dd3c733',
    panelBorder: '#222831',
    tocBg: '#0f1216',
    tocActiveBg: '#182027',
    inputBg: '#151a20',
  },
  sepia: {
    bg: '#f4ecd8',
    pageBg: '#fbf3df',
    text: '#433422',
    muted: '#6b5d4a',
    secondary: '#433422',
    accent: '#8b5e3c',
    selection: '#8b5e3c33',
    panelBorder: '#d4c9a8',
    tocBg: '#efe3c9',
    tocActiveBg: '#e8dcc4',
    inputBg: '#efe3c9',
  },
  green: {
    bg: '#cce8cf',
    pageBg: '#dff3e1',
    text: '#1a2e1a',
    muted: '#2d5a2d',
    secondary: '#1f3d1f',
    accent: '#16803d',
    selection: '#16803d33',
    panelBorder: '#8fbd96',
    tocBg: '#b8dcbb',
    tocActiveBg: '#a8d0ab',
    inputBg: '#b8dcbb',
  },
  light: {
    bg: '#ffffff',
    pageBg: '#ffffff',
    text: '#18181b',
    muted: '#71717a',
    secondary: '#3f3f46',
    accent: '#0f766e',
    selection: '#0f766e26',
    panelBorder: '#e4e4e7',
    tocBg: '#ffffff',
    tocActiveBg: '#f4f4f5',
    inputBg: '#f4f4f5',
  },
  white: {
    bg: '#ffffff',
    pageBg: '#ffffff',
    text: '#18181b',
    muted: '#71717a',
    secondary: '#3f3f46',
    accent: '#0f766e',
    selection: '#0f766e26',
    panelBorder: '#e4e4e7',
    tocBg: '#ffffff',
    tocActiveBg: '#f4f4f5',
    inputBg: '#f4f4f5',
  },
  cream: {
    bg: '#f4ecd8',
    pageBg: '#fbf3df',
    text: '#433422',
    muted: '#6b5d4a',
    secondary: '#433422',
    accent: '#8b5e3c',
    selection: '#8b5e3c33',
    panelBorder: '#d4c9a8',
    tocBg: '#efe3c9',
    tocActiveBg: '#e8dcc4',
    inputBg: '#efe3c9',
  },
};

const epubFontFamilies: Record<NonNullable<EpubViewerProps["fontFamily"]>, string> = {
  "font-system": 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  "font-sans": 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  "font-serif": 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
  "font-mono": 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  "font-georgia": 'Georgia, Cambria, "Times New Roman", Times, serif',
  "font-times": '"Times New Roman", Times, serif',
  "font-helvetica": 'Helvetica, Arial, ui-sans-serif, system-ui, sans-serif',
  "font-verdana": 'Verdana, Geneva, ui-sans-serif, system-ui, sans-serif',
  "font-kaiti": '"Kaiti SC", "KaiTi", "STKaiti", serif',
  "font-songti": '"Songti SC", "SimSun", "STSong", serif',
};

export const EpubViewer: React.FC<EpubViewerProps> = ({
  fileData,
  theme,
  fontSize,
  fontFamily = "font-sans",
  wordSpacing = 0,
  bookId,
  initialCfi,
  onProgress,
  onTextExtracted
}) => {
  const viewerRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<any>(null);
  const eventCleanupRef = useRef<(() => void) | null>(null);
  const resizeTimerRef = useRef<number | null>(null);
  const restoreGenerationRef = useRef(0);
  const currentCfiRef = useRef<string>("");
  const isRestoringLayoutRef = useRef(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [toc, setToc] = useState<Array<{ label: string; href: string }>>([]);
  const [showToc, setShowToc] = useState(false);

  const settingsRef = useRef({ theme, fontSize, fontFamily, wordSpacing });
  useEffect(() => { settingsRef.current = { theme, fontSize, fontFamily, wordSpacing }; }, [theme, fontSize, fontFamily, wordSpacing]);

  const currentTheme = themeConfigs[theme] || themeConfigs['dark'];
  const restoreRenditionLayout = useCallback((rendition: any) => {
    const generation = ++restoreGenerationRef.current;
    const stableCfi = currentCfiRef.current || rendition.currentLocation?.()?.start?.cfi;

    try {
      isRestoringLayoutRef.current = true;
      rendition.resize();
      if (stableCfi) {
        void rendition.display(stableCfi).catch((err: unknown) => {
          console.warn("⚠️ [EPUB RESIZE] 恢复阅读位置失败:", err);
        });
      }

      window.setTimeout(() => {
        if (generation !== restoreGenerationRef.current) return;
        try {
          rendition.resize();
          if (stableCfi) {
            void rendition.display(stableCfi).catch((err: unknown) => {
              console.warn("⚠️ [EPUB RESIZE] 二次恢复阅读位置失败:", err);
            });
          }
        } catch {}

        window.setTimeout(() => {
          isRestoringLayoutRef.current = false;
        }, 120);
      }, 180);
    } catch (err) {
      isRestoringLayoutRef.current = false;
      console.warn("⚠️ [EPUB RESIZE] 容器尺寸变化后重排失败:", err);
    }
  }, []);

  useEffect(() => {
    if (!fileData || !viewerRef.current) return;

    let isCurrent = true;
    let book: any = null;
    let rendition: any = null;

    viewerRef.current.innerHTML = '';

    const pureBuffer = fileData instanceof ArrayBuffer ? fileData : new Uint8Array(fileData).buffer;
    book = ePub(pureBuffer);

    book.ready.then(() => {
      if (!isCurrent || !viewerRef.current) {
        book.destroy();
        return;
      }

      rendition = book.renderTo(viewerRef.current, {
        manager: "default",
        flow: "paginated",
        width: "100%",
        height: "100%"
      });
      renditionRef.current = rendition;

      rendition.hooks.content.register((contents: any) => {
        const { theme: activeTheme, fontSize: activeSize, fontFamily: activeFontFamily, wordSpacing: activeWordSpacing } = settingsRef.current;
        const s = themeConfigs[activeTheme] || themeConfigs['dark'];
        const activeFontStack = epubFontFamilies[activeFontFamily] || epubFontFamilies["font-sans"];
        const activeWordSpacingPx = `${activeWordSpacing}px`;

        contents.addStylesheetRules({
          "body": {
            "color": `${s.text} !important`,
            "background": `${s.pageBg} !important`,
            "font-size": `${activeSize}px !important`,
            "font-family": `${activeFontStack} !important`,
            "word-spacing": `${activeWordSpacingPx} !important`,
            "line-height": "1.6 !important",
            "padding": "0 40px !important"
          },
          "p, div, span, section, article, li, blockquote, h1, h2, h3, h4, h5, h6": {
            "font-family": `${activeFontStack} !important`,
            "word-spacing": `${activeWordSpacingPx} !important`
          },
          "a": {
            "color": `${s.accent} !important`
          },
          "code, pre": {
            "background": `${s.bg} !important`,
            "color": `${s.text} !important`
          },
          "::selection": {
            "background": `${s.selection} !important`
          }
        });

        if (eventCleanupRef.current) {
          try { eventCleanupRef.current(); } catch(e) {}
          eventCleanupRef.current = null;
        }

        try {
          const iframeDoc = contents.document;
          const iframeWin = contents.window;

          if (iframeDoc && iframeWin) {
            const handleMouseUp = (e: MouseEvent) => {
              const selection = iframeWin.getSelection();
              const selectedText = selection ? selection.toString().trim() : '';

              if (selectedText) {
                console.log("🎯 [BUS] iframe 内捕获选中文本，向外派发:", selectedText);
                const iframe = viewerRef.current?.querySelector('iframe');
                const iframeRect = iframe?.getBoundingClientRect();
                const clientX = (iframeRect?.left || 0) + e.clientX;
                const clientY = (iframeRect?.top || 0) + e.clientY;

                window.dispatchEvent(new CustomEvent('epub-text-select', {
                  detail: { text: selectedText, x: clientX, y: clientY }
                }));
              } else {
                window.dispatchEvent(new CustomEvent('epub-dismiss-popover'));
              }
            };

            const handleContextMenu = (e: MouseEvent) => {
              const selection = iframeWin.getSelection();
              const selectedText = selection ? selection.toString().trim() : '';

              if (selectedText) {
                e.preventDefault();
                const iframe = viewerRef.current?.querySelector('iframe');
                const iframeRect = iframe?.getBoundingClientRect();
                const clientX = (iframeRect?.left || 0) + e.clientX;
                const clientY = (iframeRect?.top || 0) + e.clientY;

                window.dispatchEvent(new CustomEvent('epub-context-menu', {
                  detail: { text: selectedText, x: clientX, y: clientY }
                }));
              } else {
                window.dispatchEvent(new CustomEvent('epub-dismiss-popover'));
              }
            };

            iframeDoc.addEventListener('mouseup', handleMouseUp);
            iframeDoc.addEventListener('contextmenu', handleContextMenu);

            eventCleanupRef.current = () => {
              iframeDoc.removeEventListener('mouseup', handleMouseUp);
              iframeDoc.removeEventListener('contextmenu', handleContextMenu);
            };
          }
        } catch (err) {
          console.warn("⚠️ [EVENT PATCH] 事件代理失败:", err);
        }
      });

      rendition.on('relocated', (location: any) => {
        if (location?.start?.cfi) {
          if (isRestoringLayoutRef.current) return;
          const cfi = location.start.cfi;
          currentCfiRef.current = cfi;
          console.log("📖 [EPUB] relocated =>", cfi);
          localStorage.setItem(`epub_progress_${bookId}`, cfi);
          if (onProgress) { onProgress(cfi); }
        }
      });

      if (onTextExtracted) {
        rendition.on('relocated', () => {
          try {
            const contents = rendition.getContents();
            if (contents && contents.length > 0) {
              const texts: string[] = [];
              for (const content of contents) {
                if (content.document?.body) {
                  const raw = content.document.body.innerText || content.document.body.textContent || '';
                  const trimmed = raw.replace(/\s+/g, ' ').trim();
                  if (trimmed) texts.push(trimmed);
                }
              }
              if (texts.length > 0) onTextExtracted(texts.join('\n\n'));
            }
          } catch (err) {
            console.warn('⚠️ [EPUB TEXT] 页面试取失败:', err);
          }
        });
      }

      const extractToc = (nav: any): Array<{ label: string; href: string }> | null => {
        if (!nav) return null;
        const items = nav.toc || nav;
        if (!Array.isArray(items) || items.length === 0) return null;
        const result: Array<{ label: string; href: string }> = [];
        const walk = (list: any[]) => {
          for (const item of list) {
            if (item.label && item.href) {
              result.push({ label: item.label.trim(), href: item.href });
            }
            if (item.subitems && item.subitems.length > 0) {
              walk(item.subitems);
            }
          }
        };
        walk(items);
        return result.length > 0 ? result : null;
      };

      const tocResolved = extractToc(book.navigation);
      if (tocResolved) {
        console.log("📚 [TOC] book.navigation.toc 目录提取成功:", tocResolved.length, "项");
        setToc(tocResolved);
      } else if (book.loaded?.navigation) {
        book.loaded.navigation.then((nav: any) => {
          const tocData = extractToc(nav);
          if (tocData) {
            console.log("📚 [TOC] book.loaded.navigation 目录提取成功:", tocData.length, "项");
            setToc(tocData);
          } else {
            console.warn("⚠️ [TOC] 未在导航中找到目录，尝试 spine 回退");
            fallbackToc();
          }
        }).catch((err: any) => {
          console.warn("⚠️ [TOC] book.loaded.navigation 加载失败:", err);
          fallbackToc();
        });
      } else {
        fallbackToc();
      }

      function fallbackToc() {
        try {
          const spineItems = book.spine?.spineItems;
          if (spineItems && spineItems.length > 0) {
            const fallback = spineItems.map((item: any, idx: number) => ({
              label: `章节 ${idx + 1}`,
              href: item.href || ''
            }));
            console.log("📚 [TOC] spine 回退生成目录:", fallback.length, "项");
            setToc(fallback);
          } else {
            console.warn("⚠️ [TOC] spine 也无数据，无法生成目录");
          }
        } catch (e) {
          console.warn("⚠️ [TOC] spine 回退失败:", e);
        }
      }

      const urlParams = new URLSearchParams(window.location.search);
      const cfiFromUrl = urlParams.get('cfi');
      const savedCfi = localStorage.getItem(`epub_progress_${bookId}`);
      const finalCfi = cfiFromUrl ? decodeURIComponent(cfiFromUrl) : (savedCfi || initialCfi || undefined);

      if (finalCfi) {
        currentCfiRef.current = finalCfi;
        console.log("🎯 [STABLE LOCATION] 目标CFI:", finalCfi, "(来源:", cfiFromUrl ? "URL" : savedCfi ? "localStorage" : "initialCfi", ")");
      }

      const performDisplay = (): Promise<void> => {
        if (finalCfi) {
          const perfStart = performance.now();
          return rendition.display(finalCfi).then(() => {
            const elapsed = (performance.now() - perfStart).toFixed(0);
            console.log(`✅ [EPUB] display 完成 (${elapsed}ms), 触发 resize 校准`);
            setTimeout(() => {
              rendition.resize();
              console.log("📐 [EPUB] resize 校准完成");
            }, 100);
          }).catch((err: any) => {
            console.warn("⚠️ [EPUB] display(cfi) 失败:", finalCfi, err);
            return rendition.display();
          });
        } else {
          return rendition.display();
        }
      };

      const container = viewerRef.current;
      return new Promise<void>((resolve) => {
        const checkTimer = setInterval(() => {
          if (container && container.clientWidth > 0) {
            clearInterval(checkTimer);
            setTimeout(() => {
              performDisplay().then(() => resolve());
            }, 150);
          }
        }, 50);

        setTimeout(() => {
          clearInterval(checkTimer);
          performDisplay().then(() => resolve());
        }, 3000);
      });
    }).then(() => {
      if (isCurrent) setIsLoaded(true);
    }).catch((err: any) => {
      console.error("阅读器内核初始化断裂:", err);
    });

    return () => {
      isCurrent = false;
      setIsLoaded(false);
      if (eventCleanupRef.current) {
        try { eventCleanupRef.current(); } catch(e) {}
        eventCleanupRef.current = null;
      }
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = null;
      }
      if (rendition) { try { rendition.destroy(); } catch(e){} }
      if (book) { try { book.destroy(); } catch(e){} }
    };
  }, [fileData]);

  useEffect(() => {
    const container = viewerRef.current;
    const rendition = renditionRef.current;
    if (!isLoaded || !container || !rendition || typeof ResizeObserver === "undefined") return;

    let lastWidth = container.clientWidth;
    let lastHeight = container.clientHeight;

    const scheduleResize = () => {
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current);
      }

      resizeTimerRef.current = window.setTimeout(() => {
        resizeTimerRef.current = null;
        restoreRenditionLayout(rendition);
      }, 280);
    };

    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (Math.abs(width - lastWidth) < 1 && Math.abs(height - lastHeight) < 1) return;
      lastWidth = width;
      lastHeight = height;
      isRestoringLayoutRef.current = true;
      scheduleResize();
    });

    observer.observe(container);
    scheduleResize();

    return () => {
      observer.disconnect();
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = null;
      }
    };
  }, [isLoaded, restoreRenditionLayout]);

  useEffect(() => {
    if (!isLoaded || !renditionRef.current) return;
    try {
      const s = themeConfigs[theme] || themeConfigs['dark'];
      const activeFontStack = epubFontFamilies[fontFamily] || epubFontFamilies["font-sans"];
      const activeWordSpacing = `${wordSpacing}px`;
      renditionRef.current.views().forEach((view: any) => {
        view.contents?.addStylesheetRules({
          "body": {
            "color": `${s.text} !important`,
            "background": `${s.pageBg} !important`,
            "font-size": `${fontSize}px !important`,
            "font-family": `${activeFontStack} !important`,
            "word-spacing": `${activeWordSpacing} !important`,
            "line-height": "1.6 !important"
          },
          "p, div, span, section, article, li, blockquote, h1, h2, h3, h4, h5, h6": {
            "font-family": `${activeFontStack} !important`,
            "word-spacing": `${activeWordSpacing} !important`
          },
          "a": {
            "color": `${s.accent} !important`
          },
          "::selection": {
            "background": `${s.selection} !important`
          }
        });
      });
      restoreRenditionLayout(renditionRef.current);
    } catch (e) {}
  }, [theme, fontSize, fontFamily, wordSpacing, isLoaded, restoreRenditionLayout]);

  return (
    <div className="flex h-full w-full bg-[var(--reader-bg)]" style={{ backgroundColor: currentTheme.bg }}>
      <div
        className={`border-r transition-all duration-200 ${showToc ? 'w-64' : 'w-12'} flex flex-col h-full overflow-hidden shrink-0`}
        style={{ backgroundColor: currentTheme.tocBg, borderColor: currentTheme.panelBorder }}
      >
        <button
          onClick={() => { setShowToc(!showToc); setTimeout(() => renditionRef.current?.resize(), 250); }}
          className="flex min-h-11 cursor-pointer items-center gap-2 border-b px-3 text-left text-xs font-medium transition-colors"
          style={{ borderColor: currentTheme.panelBorder, color: currentTheme.muted }}
          onMouseEnter={(e) => { e.currentTarget.style.color = currentTheme.text; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = currentTheme.muted; }}
          aria-label={showToc ? "隐藏 EPUB 目录" : "显示 EPUB 目录"}
        >
          {showToc ? <PanelLeftClose size={16} /> : <List size={16} />}
          {showToc && <span>隐藏目录</span>}
        </button>
        {showToc && (
          <div className="flex-1 overflow-y-auto p-2 space-y-1 select-none">
            {toc.map((item, idx) => (
              <button
                key={idx}
                onClick={() => {
                  console.log("🚀 [TOC JUMP] 用户点击目录，狙击至:", item.href);
                  renditionRef.current?.display(item.href);
                }}
                className="min-h-8 w-full truncate rounded-lg px-2 text-left font-sans text-xs transition-colors"
                style={{ color: currentTheme.secondary }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = currentTheme.tocActiveBg;
                  e.currentTarget.style.color = currentTheme.text;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.color = currentTheme.secondary;
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="relative flex-1 flex flex-col min-w-0">
        {isLoaded && (
          <div className="pointer-events-none absolute left-4 right-4 top-1/2 z-50 flex -translate-y-1/2 justify-between">
            <button
              onClick={() => renditionRef.current?.prev()}
              className="pointer-events-auto flex min-h-10 min-w-10 items-center justify-center rounded-full border shadow-[0_10px_24px_rgba(0,0,0,0.22)] backdrop-blur-sm transition-colors"
              style={{ backgroundColor: currentTheme.inputBg, borderColor: currentTheme.panelBorder, color: currentTheme.text }}
              onMouseEnter={(e) => { e.currentTarget.style.color = currentTheme.accent; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = currentTheme.text; }}
              aria-label="上一页"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              onClick={() => renditionRef.current?.next()}
              className="pointer-events-auto flex min-h-10 min-w-10 items-center justify-center rounded-full border shadow-[0_10px_24px_rgba(0,0,0,0.22)] backdrop-blur-sm transition-colors"
              style={{ backgroundColor: currentTheme.inputBg, borderColor: currentTheme.panelBorder, color: currentTheme.text }}
              onMouseEnter={(e) => { e.currentTarget.style.color = currentTheme.accent; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = currentTheme.text; }}
              aria-label="下一页"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        )}

        <div ref={viewerRef} id="epub-area" className="flex-1 w-full h-full p-4" />

        {!isLoaded && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm font-medium" style={{ backgroundColor: currentTheme.bg, color: currentTheme.muted }}>
            <Loader2 size={16} className="animate-spin" />
            正在加载阅读沙箱...
          </div>
        )}
      </div>
    </div>
  );
};
