"use client";

import React, { useEffect, useRef, useState } from 'react';
import ePub from 'epubjs';

interface EpubViewerProps {
  fileData: any;
  theme: string;
  fontSize: number;
  bookId: string;
  initialCfi?: string;
  onProgress?: (cfi: string) => void;
  onTextExtracted?: (text: string) => void;
}

const themeConfigs: Record<string, { bg: string; text: string }> = {
  dark: { bg: '#09090b', text: '#f4f4f5' },
  light: { bg: '#ffffff', text: '#09090b' },
  white: { bg: '#ffffff', text: '#09090b' },
  green: { bg: '#f0fdf4', text: '#166534' },
  cream: { bg: '#fdf6e3', text: '#586e75' },
};

export const EpubViewer: React.FC<EpubViewerProps> = ({
  fileData,
  theme,
  fontSize,
  bookId,
  initialCfi,
  onProgress,
  onTextExtracted
}) => {
  const viewerRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<any>(null);
  const eventCleanupRef = useRef<(() => void) | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [toc, setToc] = useState<Array<{ label: string; href: string }>>([]);
  const [showToc, setShowToc] = useState(false);

  const settingsRef = useRef({ theme, fontSize });
  useEffect(() => { settingsRef.current = { theme, fontSize }; }, [theme, fontSize]);

  const currentTheme = themeConfigs[theme] || themeConfigs['dark'];

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
        const { theme: activeTheme, fontSize: activeSize } = settingsRef.current;
        const s = themeConfigs[activeTheme] || themeConfigs['dark'];

        contents.addStylesheetRules({
          "body": {
            "color": `${s.text} !important`,
            "background": `${s.bg} !important`,
            "font-size": `${activeSize}px !important`,
            "line-height": "1.6 !important",
            "padding": "0 40px !important"
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
          const cfi = location.start.cfi;
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
      if (rendition) { try { rendition.destroy(); } catch(e){} }
      if (book) { try { book.destroy(); } catch(e){} }
    };
  }, [fileData]);

  useEffect(() => {
    if (!isLoaded || !renditionRef.current) return;
    try {
      const s = themeConfigs[theme] || themeConfigs['dark'];
      renditionRef.current.views().forEach((view: any) => {
        view.contents?.addStylesheetRules({
          "body": {
            "color": `${s.text} !important`,
            "background": `${s.bg} !important`,
            "font-size": `${fontSize}px !important`
          }
        });
      });
    } catch (e) {}
  }, [theme, fontSize, isLoaded]);

  return (
    <div className="flex w-full h-full" style={{ backgroundColor: currentTheme.bg }}>
      <div className={`bg-zinc-900 border-r border-zinc-800 transition-all duration-200 ${showToc ? 'w-64' : 'w-12'} flex flex-col h-full overflow-hidden shrink-0`}>
        <button
          onClick={() => { setShowToc(!showToc); setTimeout(() => renditionRef.current?.resize(), 250); }}
          className="p-3 text-zinc-400 hover:text-zinc-200 font-bold border-b border-zinc-800 text-left text-sm"
        >
          {showToc ? "⬅️ 隐藏目录" : "📖 目录"}
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
                className="w-full text-left font-sans text-xs text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 p-2 rounded truncate transition-colors"
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="relative flex-1 flex flex-col min-w-0">
        {isLoaded && (
          <div className="absolute top-1/2 left-4 right-4 z-50 flex justify-between pointer-events-none -translate-y-1/2">
            <button
              onClick={() => renditionRef.current?.prev()}
              className="p-3 rounded-full bg-zinc-800/80 text-zinc-200 hover:bg-zinc-700 pointer-events-auto shadow-lg backdrop-blur-sm transition-all"
            >
              上页
            </button>
            <button
              onClick={() => renditionRef.current?.next()}
              className="p-3 rounded-full bg-zinc-800/80 text-zinc-200 hover:bg-zinc-700 pointer-events-auto shadow-lg backdrop-blur-sm transition-all"
            >
              下页
            </button>
          </div>
        )}

        <div ref={viewerRef} id="epub-area" className="flex-1 w-full h-full p-4" />

        {!isLoaded && (
          <div className="absolute inset-0 flex items-center justify-center font-medium" style={{ backgroundColor: currentTheme.bg, color: currentTheme.text }}>
            正在加载纯净阅读沙箱...
          </div>
        )}
      </div>
    </div>
  );
};
