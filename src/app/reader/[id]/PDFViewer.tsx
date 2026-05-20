"use client";

import { useEffect, useState, useRef, useMemo, useCallback, useImperativeHandle, forwardRef, type ComponentType } from "react";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

export interface PDFViewerHandle {
  scrollToPage: (page: number) => void;
}

interface PDFViewerProps {
  pdfData: ArrayBuffer;
  zoom: number;
  currentPage: number;
  onLoadSuccess: (pdf: { numPages: number }) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onPageChange: (page: number) => void;
  onTextSelect?: (text: string, centerX: number, rectTop: number, rectBottom: number) => void;
  initialProgress?: number;
}

const BUFFER = 1;
const PAGE_WIDTH = 800;

function PageCanvasGuard({ children }: { children: React.ReactNode }) {
  const guardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    return () => {
      if (!guardRef.current) return;
      guardRef.current.querySelectorAll("canvas").forEach((c) => {
        c.width = 0;
        c.height = 0;
      });
    };
  }, []);
  return <div ref={guardRef}>{children}</div>;
}

const PDFViewer = forwardRef<PDFViewerHandle, PDFViewerProps>(({
  pdfData,
  zoom,
  currentPage,
  onLoadSuccess,
  onContextMenu,
  onPageChange,
  onTextSelect,
  initialProgress,
}, ref) => {
  const [ready, setReady] = useState(false);
  const [numPages, setNumPages] = useState(0);
  const [isPdfLoaded, setIsPdfLoaded] = useState(false);
  const [visibleRange, setVisibleRange] = useState({ start: 1, end: 1 });
  const [containerWidth, setContainerWidth] = useState(PAGE_WIDTH);
  const DocRef = useRef<ComponentType<any> | null>(null);
  const PageRef = useRef<ComponentType<any> | null>(null);
  const pdfjsVersionRef = useRef("");
  const containerRef = useRef<HTMLDivElement>(null);
  const onPageChangeRef = useRef(onPageChange);
  const onTextSelectRef = useRef(onTextSelect);
  const debounceTimer = useRef(0);
  const isRestoringRef = useRef(true);
  const isJumpingRef = useRef(false);
  const lastZoomRef = useRef(zoom);

  onPageChangeRef.current = onPageChange;
  onTextSelectRef.current = onTextSelect;

  const pdfFile = useMemo(() => ({ data: pdfData }), [pdfData]);
  const pdfOptions = useMemo(() => ({
    cMapUrl: `//unpkg.com/pdfjs-dist@${pdfjsVersionRef.current}/cmaps/`,
    cMapPacked: true,
  }), []);

  const scaledWidth = Math.round(containerWidth * zoom);
  const estimatedPageHeight = Math.round(scaledWidth * 1.414);
  const estimatedPageHeightRef = useRef(estimatedPageHeight);
  estimatedPageHeightRef.current = estimatedPageHeight;

  const setVisibleAroundPage = useCallback((page: number) => {
    setVisibleRange({
      start: Math.max(1, page - BUFFER),
      end: Math.min(numPages, page + BUFFER),
    });
  }, [numPages]);

  const scrollToPageElement = useCallback((page: number) => {
    const container = containerRef.current;
    if (!container || !numPages || page < 1 || page > numPages) return false;
    const target = document.getElementById(`page_${page}`);
    if (!target) return false;
    container.scrollTo({ top: target.offsetTop, behavior: "auto" });
    return true;
  }, [numPages]);

  useEffect(() => {
    import("react-pdf").then((mod) => {
      const version = mod.pdfjs.version;
      pdfjsVersionRef.current = version;
      mod.pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      DocRef.current = mod.Document as ComponentType<any>;
      PageRef.current = mod.Page as ComponentType<any>;
      setReady(true);
    });
  }, []);

  const handleLoadSuccess = useCallback((pdf: { numPages: number }) => {
    setNumPages(pdf.numPages);
    setIsPdfLoaded(true);
    setVisibleRange({ start: 1, end: Math.min(3, pdf.numPages) });
    onLoadSuccess(pdf);
  }, [onLoadSuccess]);

  useEffect(() => {
    if (!isPdfLoaded) return;
    if (!initialProgress || initialProgress <= 1) {
      isRestoringRef.current = false;
      return;
    }
    const targetPage = Math.min(initialProgress, numPages || initialProgress);
    setVisibleAroundPage(targetPage);
    const timer = setTimeout(() => {
      scrollToPageElement(targetPage);
      onPageChangeRef.current(targetPage);
      setTimeout(() => { isRestoringRef.current = false; }, 300);
    }, 100);
    return () => clearTimeout(timer);
  }, [isPdfLoaded, initialProgress, numPages, scrollToPageElement, setVisibleAroundPage]);

  useImperativeHandle(ref, () => ({
    scrollToPage: (page: number) => {
      if (page < 1 || page > numPages) return;
      isJumpingRef.current = true;
      setVisibleAroundPage(page);
      requestAnimationFrame(() => {
        scrollToPageElement(page);
      });
      onPageChangeRef.current(page);
      setTimeout(() => { isJumpingRef.current = false; }, 250);
    },
  }), [numPages, scrollToPageElement, setVisibleAroundPage]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = window.setTimeout(() => {
      const sel = window.getSelection();
      const selectedText = sel?.toString().trim();
      if (!selectedText || selectedText.length < 2) return;
      const target = e.target as HTMLElement;
      if (target.closest(".context-menu") || target.closest(".translate-popover")) return;
      const range = sel?.getRangeAt(0);
      const rect = range?.getBoundingClientRect();
      if (!rect) return;
      onTextSelectRef.current?.(selectedText, rect.left + rect.width / 2, rect.top, rect.bottom);
    }, 200);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || numPages === 0) return;

    let rafId = 0;
    const handleScroll = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (isRestoringRef.current || isJumpingRef.current) return;
        const containerRect = container.getBoundingClientRect();
        const viewCenter = containerRect.top + containerRect.height / 2;
        let closestPage = 1;
        let closestDist = Infinity;
        for (let i = 0; i < numPages; i++) {
          const el = document.getElementById(`page_${i + 1}`);
          if (!el) continue;
          const rect = el.getBoundingClientRect();
          const elCenter = rect.top + rect.height / 2;
          const dist = Math.abs(elCenter - viewCenter);
          if (dist < closestDist) {
            closestDist = dist;
            closestPage = i + 1;
          }
        }
        const start = Math.max(1, closestPage - BUFFER);
        const end = Math.min(numPages, closestPage + BUFFER);
        setVisibleRange({ start, end });
        onPageChangeRef.current(closestPage);
      });
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();

    return () => {
      container.removeEventListener("scroll", handleScroll);
      cancelAnimationFrame(rafId);
    };
  }, [numPages]);

  useEffect(() => {
    if (!containerRef.current) return;
    let rafId = 0;
    const observer = new ResizeObserver((entries) => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        setContainerWidth(Math.round(entries[0].contentRect.width - 32));
      });
    });
    observer.observe(containerRef.current);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(rafId);
    };
  }, []);

  useEffect(() => {
    if (!isPdfLoaded || !numPages || lastZoomRef.current === zoom) return;
    const anchorPage = Math.max(1, Math.min(currentPage, numPages));
    lastZoomRef.current = zoom;
    isJumpingRef.current = true;
    setVisibleAroundPage(anchorPage);
    const timer = window.setTimeout(() => {
      scrollToPageElement(anchorPage);
      onPageChangeRef.current(anchorPage);
      window.setTimeout(() => { isJumpingRef.current = false; }, 200);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [currentPage, isPdfLoaded, numPages, scrollToPageElement, setVisibleAroundPage, zoom]);

  if (!ready) {
    return (
      <div className="flex-1 h-full w-full flex items-center justify-center bg-[var(--reader-bg)]">
        <div className="text-sm text-[var(--text-muted)]">正在加载 PDF 引擎...</div>
      </div>
    );
  }

  const Document = DocRef.current!;
  const Page = PageRef.current!;

  return (
    <div
      ref={containerRef}
      className="flex-1 h-full w-full overflow-auto bg-[var(--reader-bg)]"
      onContextMenu={onContextMenu}
      onMouseUp={handleMouseUp}
    >
      <style>{`
        .react-pdf__Page__textContent { pointer-events: auto !important; z-index: 10 !important; }
        .react-pdf__Page__textContent span { cursor: text !important; }
      `}</style>
      <Document
        file={pdfFile}
        onLoadSuccess={handleLoadSuccess}
        onLoadError={(error: Error) => console.error("🚨 PDF 加载失败:", error.message)}
        onSourceError={(error: Error) => console.error("🚨 PDF 数据源错误:", error.message)}
        options={pdfOptions}
        loading={<div className="py-20 text-center text-sm text-[var(--text-muted)]">正在渲染高清页面...</div>}
        className="flex flex-col items-center py-8 gap-4"
      >
        {numPages > 0 && Array.from({ length: numPages }, (_, i) => {
          const pageNum = i + 1;
          const isVisible = pageNum >= visibleRange.start && pageNum <= visibleRange.end;
          return (
            <div key={pageNum} id={`page_${pageNum}`} style={{ position: "relative" }}>
              {isVisible ? (
                <PageCanvasGuard>
                  <Page
                    pageNumber={pageNum}
                    renderTextLayer={true}
                    renderAnnotationLayer={true}
                    className="bg-white shadow-2xl"
                    width={scaledWidth}
                  />
                </PageCanvasGuard>
              ) : (
                <div
                  style={{ width: scaledWidth, height: estimatedPageHeight, contentVisibility: "auto", containIntrinsicSize: `${estimatedPageHeight}px` }}
                  className="flex select-none items-center justify-center bg-[var(--panel-bg)] text-xs text-[var(--text-muted)]"
                >
                  {pageNum}
                </div>
              )}
            </div>
          );
        })}
      </Document>
    </div>
  );
});

PDFViewer.displayName = "PDFViewer";
export default PDFViewer;
