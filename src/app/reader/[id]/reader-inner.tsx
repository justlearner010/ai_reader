"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import type { PDFViewerHandle } from "./PDFViewer";
import {
  Upload,
  Send,
  BookOpen,
  User,
  Bot,
  Loader2,
  List,
  PanelRightClose,
  GripVertical,
  ArrowLeft,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Search,
  StickyNote,
  Bookmark,
  Copy,
  Edit,
  Download,
  ArrowUpRight,
  Settings,
} from "lucide-react";
import { cleanText } from "@/utils/textCleaner";
import { getBookById, deleteBook, getFileData, updateBookProgress, updateEpubProgress, getNotes, saveNote, deleteNote, updateNote, type BookMeta, type Note } from "@/utils/storage";
import localforage from "localforage";
import "prismjs/themes/prism-tomorrow.css";

function isCodeSnippet(text: string): boolean {
  if (/\b#include\b/.test(text)) return true;
  if (/\bmain\s*\(/.test(text)) return true;
  if (/\b(struct|typedef|enum|union)\s+\w+/.test(text)) return true;
  const codeKeywords = /\b(int|void|char|float|double|long|short|unsigned|signed|const|static|return|if\s*\(|for\s*\(|while\s*\(|switch\s*\(|printf|scanf|malloc|free|sizeof)\b/g;
  const matches = text.match(codeKeywords);
  const keywordCount = matches ? matches.length : 0;
  const hasPunctuation = text.includes(";") || (text.includes("{") && text.includes("}"));
  return keywordCount >= 2 && hasPunctuation;
}

function getCurrentChapter(activePage: number, tocItems: BookMeta["tocItems"]): string {
  if (!tocItems || tocItems.length === 0) return "";
  let chapter = "";
  for (const item of tocItems) {
    if (item.page <= activePage) chapter = item.title;
    else break;
  }
  return chapter;
}

const PDFViewer = dynamic(() => import("./PDFViewer"), { ssr: false });
const EpubViewer = dynamic(() => import("./EpubViewer").then(m => ({ default: m.EpubViewer })), { ssr: false });
const MAX_AI_CONTEXT_CHARS = 12_000;

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  parsed?: { term: string; definition: string; essence: string; context: string };
}

interface ApiConfig {
  engineMode: string;
  temperature: number;
  cloud: {
    currentProvider: string;
    keys: Record<string, string>;
    customUrl: string;
    customModel: string;
  };
  local: {
    url: string;
    model: string;
  };
}

function limitAiContext(raw: string): string {
  const text = cleanText(raw);
  if (text.length <= MAX_AI_CONTEXT_CHARS) return text;
  const half = Math.floor(MAX_AI_CONTEXT_CHARS / 2);
  return `${text.slice(0, half)}\n\n...[已截断中间内容，避免上下文过长]...\n\n${text.slice(-half)}`;
}

async function resolveOutlinePages(
  items: Array<{ title: string; dest: string | Array<unknown> | null; items: Array<unknown> }>,
  pdfDoc: any,
  level: number,
): Promise<BookMeta["tocItems"]> {
  const result: BookMeta["tocItems"] = [];
  for (const item of items) {
    let page = 0;
    if (item.dest) {
      if (typeof item.dest === "string") {
        try {
          const dest = await pdfDoc.getDestination(item.dest);
          if (dest && Array.isArray(dest) && dest[0]) {
            const pageIndex = await pdfDoc.getPageIndex(dest[0]);
            page = pageIndex + 1;
          }
        } catch {}
      } else if (Array.isArray(item.dest)) {
        const pageRef = item.dest[0];
        if (pageRef) {
          try {
            const pageIndex = await pdfDoc.getPageIndex(pageRef);
            page = pageIndex + 1;
          } catch {}
        }
      }
    }
    result.push({ title: item.title, page: page || 1, level });
    if (item.items && item.items.length > 0) {
      result.push(
        ...(await resolveOutlinePages(
          item.items as Array<{ title: string; dest: string | Array<unknown> | null; items: Array<unknown> }>,
          pdfDoc,
          level + 1,
        )),
      );
    }
  }
  return result;
}

const THEMES = {
  dark: { bg: "#09090b", text: "#daffde", name: "深色" },
  sepia: { bg: "#f4ecd8", text: "#433422", name: "羊皮纸" },
  green: { bg: "#cce8cf", text: "#1a2e1a", name: "护眼" },
  light: { bg: "#ffffff", text: "#111111", name: "纯白" },
} as const;

type ThemeKey = keyof typeof THEMES;

const THEME_VARS: Record<ThemeKey, Record<string, string>> = {
  dark: {
    "--panel-bg": "#09090b",
    "--panel-border": "#27272a",
    "--text-muted": "#a1a1aa",
    "--text-secondary": "#d4d4d8",
    "--foreground": "#e4e4e7",
    "--input-bg": "#18181b",
    "--accent": "#10b981",
    "--chat-user-bg": "#18181b",
    "--chat-ai-bg": "#1a1a2e",
  },
  sepia: {
    "--panel-bg": "#f4ecd8",
    "--panel-border": "#d4c9a8",
    "--text-muted": "#6b5d4a",
    "--text-secondary": "#433422",
    "--foreground": "#433422",
    "--input-bg": "#efe3c9",
    "--accent": "#8b5e3c",
    "--chat-user-bg": "#efe3c9",
    "--chat-ai-bg": "#e8dcc4",
  },
  green: {
    "--panel-bg": "#cce8cf",
    "--panel-border": "#a8c8ab",
    "--text-muted": "#2d5a2d",
    "--text-secondary": "#1a2e1a",
    "--foreground": "#1a2e1a",
    "--input-bg": "#b8dcbb",
    "--accent": "#16a34a",
    "--chat-user-bg": "#b8dcbb",
    "--chat-ai-bg": "#a8d0ab",
  },
  light: {
    "--panel-bg": "#ffffff",
    "--panel-border": "#e4e4e7",
    "--text-muted": "#71717a",
    "--text-secondary": "#3f3f46",
    "--foreground": "#18181b",
    "--input-bg": "#f4f4f5",
    "--accent": "#10b981",
    "--chat-user-bg": "#f4f4f5",
    "--chat-ai-bg": "#e8f5e9",
  },
};

const PROVIDER_PRESETS: Record<string, { name: string; url: string; model: string }> = {
  deepseek: { name: 'DeepSeek 官方', url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  siliconflow: { name: '硅基流动 (SiliconFlow)', url: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3' },
  openai: { name: 'OpenAI', url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  openrouter: { name: 'OpenRouter', url: 'https://openrouter.ai/api/v1', model: 'google/gemini-2.5-flash' },
  custom: { name: 'Custom (自定义中转)', url: '', model: '' },
};

const AI_IDENTITIES: Record<string, { name: string; prompt: string }> = {
  default: {
    name: "💡 综合技术专家",
    prompt: "你是一个一针见血的技术与文学专家，请用最简练、直击本质的话语为用户解释划词内容。"
  },
  coder: {
    name: "💻 源码推演家",
    prompt: "你是一个精通 C++、Linux 内核和 AI Infra 的硬核架构师。请直接剖析用户划词背后的底层系统机制、内存堆栈变化或算法时空复杂度，多用代码块示例，拒绝废话。"
  },
  translator: {
    name: "🔤 极简翻译官",
    prompt: "你是一个同声传译专家。请直接给出用户划词最地道的中文翻译，并在下方列出 2-3 个最核心的专业词汇延伸解析，格式要极其紧凑。"
  },
  detective: {
    name: "🔍 悬疑伏笔拆解手",
    prompt: "你是一个深谙新本格派的悬疑小说家。请帮我严密分析用户划出这段话背后的文学隐喻、心理博弈或潜在的剧情伏笔。"
  },
};

async function translateWithProvider(
  text: string,
  apiConfig: ApiConfig,
): Promise<string> {
  const isCloud = apiConfig.engineMode === 'cloud';
  let url: string;
  let model: string;
  let apiKey: string | undefined;

  if (isCloud) {
    const provider = apiConfig.cloud.currentProvider;
    apiKey = apiConfig.cloud.keys[provider];
    url = apiConfig.cloud.customUrl || PROVIDER_PRESETS[provider]?.url;
    model = apiConfig.cloud.customModel || PROVIDER_PRESETS[provider]?.model;
  } else {
    url = apiConfig.local.url;
    model = apiConfig.local.model;
  }

  if (!url || !model) return '请先配置 AI 提供商';
  if (isCloud && !apiKey) return '请先配置 API Key';

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const res = await fetch(`${url}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You are a translator. Translate the following text to Chinese. Return only the translation, no explanations.' },
          { role: 'user', content: text },
        ],
        stream: false,
        temperature: apiConfig.temperature,
      }),
    });
    if (!res.ok) {
      const errBody = await res.text();
      return `请求失败 (${res.status}): ${errBody}`;
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '翻译失败: 返回内容为空';
  } catch (e) {
    return `网络错误: ${e instanceof Error ? e.message : String(e)}`;
  }
}

const renderAIContent = (text: string) => {
  if (!text) return '';

  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  html = html.replace(/```(\w*)\n([\s\S]*?)\n```/g, (_, lang, code) => {
    return `<div class="my-3 rounded-lg overflow-hidden border border-zinc-700 font-mono text-sm">
      <div class="bg-zinc-800 text-zinc-400 px-3 py-1 text-xs flex justify-between uppercase">
        <span>${lang || 'code'}</span>
      </div>
      <pre class="bg-zinc-950 text-emerald-400 p-4 overflow-x-auto m-0 select-text font-mono leading-relaxed"><code>${code}</code></pre>
    </div>`;
  });

  html = html.replace(/`([^`]+)`/g, '<code class="bg-zinc-800 text-pink-400 px-1.5 py-0.5 rounded font-mono text-xs mx-0.5">$1</code>');

  html = html.replace(/\*\*([\s\S]+?)\*\*/g, '<strong class="font-bold text-zinc-100">$1</strong>');

  html = html.replace(/^\s*###\s+(.+)$/gm, '<h3 class="text-zinc-100 font-bold text-base mt-4 mb-2">$1</h3>');

  html = html.replace(/^\s*---\s*$/gm, '<hr class="my-4 border-t border-zinc-700" />');

  html = html.replace(/^\s*-\s+(.+)$/gm, '<li class="list-disc list-inside ml-2 my-1 text-zinc-300">$1</li>');

  html = html.replace(/\n/g, '<br />');

  return html;
};

export default function ReaderInner() {
  const params = useParams();
  const router = useRouter();
  const bookId = params.id as string;

  const [bookTitle, setBookTitle] = useState("");
  const [bookFormat, setBookFormat] = useState<"pdf" | "epub" | "txt">("txt");
  const [leftRatio, setLeftRatio] = useState(0.6);
  const [showToc, setShowToc] = useState(false);
  const [tocItems, setTocItems] = useState<BookMeta["tocItems"]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [extractedText, setExtractedText] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const memoizedHtmlContents = useMemo(() => {
    return messages.map(msg =>
      msg.content ? renderAIContent(msg.content) : ''
    );
  }, [messages]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    selectedText: string;
  } | null>(null);
  const [aiContextMenu, setAiContextMenu] = useState<{
    x: number;
    y: number;
    text: string;
  } | null>(null);
  const [translatePopover, setTranslatePopover] = useState<{
    x: number;
    y: number;
    word: string;
    loading: boolean;
    result: string;
    rectBottom: number;
    isCode: boolean;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [fileMissing, setFileMissing] = useState(false);
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);
  const [pageInput, setPageInput] = useState("1");
  const [activePage, setActivePage] = useState(1);
  const [pageMarkers, setPageMarkers] = useState<number[]>([]);
  const [aiContextText, setAiContextText] = useState("");
  const [epubPageText, setEpubPageText] = useState("");
  const [identityId, setIdentityId] = useState("default");
  const [userPrompt, setUserPrompt] = useState(AI_IDENTITIES.default.prompt);
  const [searchTerm, setSearchTerm] = useState("");
  const [fontFamily, setFontFamily] = useState<"font-sans" | "font-serif" | "font-mono">("font-sans");
  const [theme, setTheme] = useState<ThemeKey>("dark");
  const [fontSize, setFontSize] = useState(16);
  const [isPrefsLoaded, setIsPrefsLoaded] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [sidebarTab, setSidebarTab] = useState<"chat" | "notes">("chat");
  const [editingNote, setEditingNote] = useState<{
    id?: string;
    quote: string;
    pageNumber: number;
    content: string;
    isEditing: boolean;
  } | null>(null);
  const [initialProgress, setInitialProgress] = useState(0);
  const [initialCfi, setInitialCfi] = useState("");
  const [returnToPage, setReturnToPage] = useState<number | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [apiConfig, setApiConfig] = useState<ApiConfig>({
    engineMode: 'cloud',
    temperature: 1.0,
    cloud: {
      currentProvider: 'deepseek',
      keys: {
        deepseek: '',
        siliconflow: '',
        openai: '',
        openrouter: '',
        custom: '',
      },
      customUrl: '',
      customModel: '',
    },
    local: {
      url: 'http://localhost:11434/v1',
      model: 'qwen2.5',
    },
  });
  const [showSettings, setShowSettings] = useState(false);
  const [showConfig, setShowConfig] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const pdfDataRef = useRef<ArrayBuffer | null>(null);
  const initialLoadDone = useRef(false);
  const pdfDocRef = useRef<any>(null);
  const pdfViewerRef = useRef<PDFViewerHandle>(null);
  const translatePopoverRef = useRef<HTMLDivElement>(null);

  const loadPdf = useCallback((arrayBuffer: ArrayBuffer) => {
    pdfDataRef.current = arrayBuffer;
    setPdfData(arrayBuffer);
  }, []);

  const handleLoadSuccess = useCallback((pdf: { numPages: number }) => {
    setTotalPages(pdf.numPages);
    setCurrentPage(1);
  }, []);

  const goToPage = useCallback((pageNum: number) => {
    if (!totalPages) return;
    const p = Math.max(1, Math.min(pageNum, totalPages));
    setCurrentPage(p);
    pdfViewerRef.current?.scrollToPage(p);
  }, [totalPages]);

  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
  }, []);

  const handleTextSelect = useCallback((text: string, centerX: number, rectTop: number, rectBottom: number) => {
    if (isCodeSnippet(text)) {
      setTranslatePopover({
        x: centerX, y: rectTop, word: text, loading: false, result: "", rectBottom, isCode: true,
      });
      return;
    }
    const hasChinese = /[\u4e00-\u9fff]/.test(text);
    const hasNonChinese = /[^\u4e00-\u9fff\s]/.test(text);
    const isPureChinese = hasChinese && !hasNonChinese;
    if (isPureChinese) {
      setTranslatePopover({
        x: centerX, y: rectTop, word: text, loading: false, result: "", rectBottom, isCode: false,
      });
      return;
    }
    setTranslatePopover({ x: centerX, y: rectTop, word: text, loading: true, result: "", rectBottom, isCode: false });
    translateWithProvider(text, apiConfig).then((result) => {
      setTranslatePopover((p) => p ? { ...p, loading: false, result } : null);
    });
  }, [apiConfig]);

  const handleActivePageChange = useCallback((page: number) => {
    setActivePage(page);
  }, []);

  useEffect(() => {
    if (!translatePopover || !translatePopover.isCode) return;
    import("prismjs").then((Prism) => {
      const el = document.getElementById("code-highlight-content");
      if (el) {
        const lang = Prism.languages.c || Prism.languages.clike;
        el.innerHTML = Prism.highlight(translatePopover.word, lang, 'c');
      }
    });
  }, [translatePopover]);

  useEffect(() => {
    if (!translatePopover) setCopied(false);
  }, [translatePopover]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "b") {
        e.preventDefault();
        setIsSidebarOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    const arrayBuffer = pdfDataRef.current;
    if (!arrayBuffer || bookFormat !== "pdf" || extractedText.trim() || typeof window === "undefined") return;
    (async () => {
      try {
        const { pdfjs: pdfjsLib } = await import("react-pdf");
        pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;
        let fullText = "";
        const markers: number[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          try {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const text = textContent.items
              .filter((item: Record<string, unknown>) => "str" in item)
              .map((item: Record<string, unknown>) => item.str as string)
              .join(" ");
            markers.push(fullText.length);
            fullText += `\n\n--- 第 ${i} 页 ---\n\n${text}`;
          } catch {
            // single page extraction failed, continue
          }
        }
        setPageMarkers(markers);
        setExtractedText(fullText);
      } catch (err) {
        console.error("PDF 文本提取失败（不影响阅读）:", err);
      }
    })();
  }, [pdfData, bookFormat, extractedText]);

  useEffect(() => {
    const arrayBuffer = pdfDataRef.current;
    if (!arrayBuffer || bookFormat !== "pdf") return;
    (async () => {
      try {
        const { pdfjs: pdfjsLib } = await import("react-pdf");
        pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;
        pdfDocRef.current = pdf;

        const outline = await pdf.getOutline();
        if (outline && outline.length > 0) {
          const resolved = await resolveOutlinePages(
            outline as Array<{ title: string; dest: string | Array<unknown> | null; items: Array<unknown> }>,
            pdf,
            0,
          );
          setTocItems(resolved);
        }
      } catch (err) {
        console.error("目录解析失败:", err);
      }
    })();
  }, [pdfData, bookFormat]);

  const handleEpubProgress = useCallback((cfi: string) => {
    updateEpubProgress(bookId, cfi);
  }, [bookId]);

  const handleEpubTextExtracted = useCallback((text: string) => {
    setEpubPageText(cleanText(text));
  }, []);

  const changeFontSize = useCallback((delta: number) => {
    setFontSize((prev) => Math.max(12, Math.min(32, prev + delta)));
  }, []);

  const handleThemeChange = useCallback((newTheme: ThemeKey) => {
    setTheme(newTheme);
  }, []);

  useEffect(() => {
    if (!isPrefsLoaded) return;
    localforage.setItem('reader_preferences', { theme, fontSize, apiConfig });
  }, [theme, fontSize, apiConfig, isPrefsLoaded]);

  useEffect(() => {
    const loadPrefs = async () => {
      try {
        const savedSettings: any = await localforage.getItem('reader_preferences');
        if (savedSettings) {
          setTheme(savedSettings.theme || 'dark');
          setFontSize(savedSettings.fontSize || 16);
          if (savedSettings.apiConfig) {
            const old = savedSettings.apiConfig;
            if (typeof old.key !== 'undefined' && !old.cloud) {
              setApiConfig({
                engineMode: 'cloud',
                temperature: old.temperature ?? 1.0,
                cloud: {
                  currentProvider: 'custom',
                  keys: {
                    deepseek: '',
                    siliconflow: '',
                    openai: '',
                    openrouter: '',
                    custom: old.key || '',
                  },
                  customUrl: old.url || '',
                  customModel: old.model || '',
                },
                local: { url: 'http://localhost:11434/v1', model: 'qwen2.5' },
              });
            } else if (old.cloud && typeof old.cloud.key !== 'undefined') {
              setApiConfig({
                engineMode: old.engineMode || 'cloud',
                temperature: old.temperature ?? 1.0,
                cloud: {
                  currentProvider: old.cloud.currentProvider || 'deepseek',
                  keys: {
                    deepseek: old.cloud.key || old.cloud.keys?.deepseek || '',
                    siliconflow: old.cloud.keys?.siliconflow || '',
                    openai: old.cloud.keys?.openai || '',
                    openrouter: old.cloud.keys?.openrouter || '',
                    custom: old.cloud.keys?.custom || '',
                  },
                  customUrl: old.cloud.customUrl || '',
                  customModel: old.cloud.customModel || '',
                },
                local: old.local || { url: 'http://localhost:11434/v1', model: 'qwen2.5' },
              });
            } else {
              setApiConfig({ ...old, temperature: old.temperature ?? 1.0 });
            }
          }
        }
      } catch (e) {
        console.error('加载配置失败', e);
      } finally {
        setIsPrefsLoaded(true);
      }
    };
    loadPrefs();
  }, []);

  useEffect(() => {
    console.log("📚 读者页面加载，当前 bookId:", bookId);

    if (!bookId) {
      console.warn("⚠️ bookId 为空或 undefined");
      setNotFound(true);
      setIsLoading(false);
      return;
    }

    (async () => {
      try {
        const book = await getBookById(bookId);
        console.log("📖 getBookById 返回:", book ? `成功获取书籍 "${book.title}" (ID: ${book.id})` : "获取为空 (null)");

        if (!book) {
          console.warn(`⚠️ 未找到 ID 为 "${bookId}" 的书籍`);
          setNotFound(true);
          setIsLoading(false);
          return;
        }

        setBookTitle(book.title);
        setBookFormat(book.fileType);
        setTocItems(book.tocItems);
        setPageMarkers(book.pageMarkers || []);
        setInitialProgress(book.currentPage || 0);
        setInitialCfi(book.epubCfi || "");
        setFileMissing(false);
        if (book.fileType !== "epub" && book.content) {
          setExtractedText(book.content);
        }
        if (book.epubCfi) {
          localStorage.setItem(`epub_progress_${bookId}`, book.epubCfi);
        }

        if (book.fileType === "txt") {
          setExtractedText(book.content);
          setIsLoading(false);
          return;
        }

        console.log("🔍 [PARENT DIALOG] 1. 成功准备获取二进制文件，bookId:", bookId);

        try {
          const fileResult = await getFileData(bookId);
          console.log("🔍 [PARENT DIALOG] 2. getFileData 响应返回！对象是否存在:", !!fileResult);

          if (fileResult) {
            console.log("🔍 [PARENT DIALOG] 3. 文件类型:", Object.prototype.toString.call(fileResult));

            const arrayBuffer = await fileResult.arrayBuffer();
            console.log("🔍 [PARENT DIALOG] 3b. arrayBuffer 转换成功，字节数:", arrayBuffer.byteLength);

            loadPdf(arrayBuffer);
            console.log("🔍 [PARENT DIALOG] 4. loadPdf(arrayBuffer) 执行完毕");
          } else {
            console.error("🚨 [PARENT ERROR] 数据库中未找到该书籍的二进制数据！");
            setFileMissing(true);
            setIsLoading(false);
            return;
          }
        } catch (fetchErr) {
          console.error("🚨 [PARENT FATAL ERROR] 从 localforage 读取文件流失败:", fetchErr);
          setFileMissing(true);
          setIsLoading(false);
          return;
        }

        setIsLoading(false);
      } catch (err) {
        console.error("❌ 书籍加载过程抛出异常:", err);
        setNotFound(true);
        setIsLoading(false);
      }
    })();
  }, [bookId, loadPdf]);

  useEffect(() => {
    if (!bookId || isLoading) return;
    const key = `chat_history_${bookId}`;
    const stored = localStorage.getItem(key);
    if (stored) {
      try { setMessages(JSON.parse(stored)); } catch { /* ignore */ }
    }
    initialLoadDone.current = true;
  }, [bookId, isLoading]);

  useEffect(() => {
    const saved = localStorage.getItem('reader_ai_identity');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.identityId && AI_IDENTITIES[parsed.identityId]) {
          setIdentityId(parsed.identityId);
          setUserPrompt(parsed.userPrompt || AI_IDENTITIES[parsed.identityId].prompt);
        }
      } catch { /* ignore */ }
    }
  }, []);

  useEffect(() => {
    if (!bookId) return;
    getNotes(bookId).then(setNotes);
  }, [bookId]);

  useEffect(() => {
    if (!initialLoadDone.current || !bookId) return;
    localStorage.setItem(`chat_history_${bookId}`, JSON.stringify(messages));
  }, [messages, bookId]);

  useEffect(() => {
    localStorage.setItem('reader_ai_identity', JSON.stringify({ identityId, userPrompt }));
  }, [identityId, userPrompt]);

  const handleClearChat = useCallback(() => {
    setMessages([]);
    if (bookId) localStorage.removeItem(`chat_history_${bookId}`);
  }, [bookId]);

  const handleDeleteBook = useCallback(() => {
    if (!bookId) return;
    deleteBook(bookId);
    localStorage.removeItem(`chat_history_${bookId}`);
    router.push("/");
  }, [bookId, router]);

  const handleUploadClick = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBookTitle(file.name.replace(/\.(pdf|epub|txt)$/i, ""));
    setIsLoading(true);
    setTocItems([]);

    try {
      const arrayBuffer = await file.arrayBuffer();
      if (file.name.toLowerCase().endsWith(".txt")) {
        setBookFormat("txt");
        setExtractedText(await file.text());
      } else if (file.name.toLowerCase().endsWith(".epub")) {
        setBookFormat("epub");
        loadPdf(arrayBuffer);
      } else {
        setBookFormat("pdf");
        loadPdf(arrayBuffer);
      }
    } catch (err) {
      console.error("文件解析失败:", err);
    } finally { setIsLoading(false); }
    e.target.value = "";
  };

  const sendMessage = useCallback(async (text: string, fresh?: boolean) => {
    if (!text.trim() || isStreaming) return;

    const isCloud = apiConfig.engineMode === 'cloud';
    let resolvedUrl: string;
    let resolvedModel: string;
    let resolvedKey: string | undefined;

    if (isCloud) {
      const provider = apiConfig.cloud.currentProvider;
      resolvedKey = apiConfig.cloud.keys[provider];
      resolvedUrl = apiConfig.cloud.customUrl || PROVIDER_PRESETS[provider]?.url;
      resolvedModel = apiConfig.cloud.customModel || PROVIDER_PRESETS[provider]?.model;
    } else {
      resolvedUrl = apiConfig.local.url;
      resolvedModel = apiConfig.local.model;
    }

    if (!resolvedUrl || !resolvedModel) {
      setMessages((prev) => [...prev, { role: "user", content: text }, { role: "assistant", content: "**提示：请先在顶部配置你的 DeepSeek API Key**" }]);
      return;
    }
    if (isCloud && !resolvedKey) {
      setMessages((prev) => [...prev, { role: "user", content: text }, { role: "assistant", content: "**提示：请先在顶部配置你的 DeepSeek API Key**" }]);
      return;
    }

    setInput("");

    const context = limitAiContext(aiContextText || epubPageText || extractedText);
    const systemContent = `${userPrompt}\n\n用户正在阅读一本书，以下是当前页面的上下文内容：\n\n${context}\n\n请基于以上上下文回答用户的问题。如果问题与上下文无关，可以基于你的知识回答。`;

    let requestMessages: Array<{ role: string; content: string }>;

    if (fresh) {
      const freshUserContent = `针对以下电子书文本进行深度解析：\n"${text}"`;
      setMessages(prev => [
        ...prev,
        { role: 'user', content: text },
        { role: 'assistant', content: '' }
      ]);
      const historyMessages = messages.filter(m => m.role !== 'system');
      requestMessages = [
        { role: 'system', content: systemContent },
        ...historyMessages.map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: freshUserContent },
      ];
    } else {
      setMessages((prev) => [...prev, { role: 'user', content: text }]);
      setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);
      requestMessages = [
        { role: 'system', content: systemContent },
        ...messages.filter(m => m.role !== 'system').map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: text },
      ];
    }

    setIsStreaming(true);

    try {
      const requestHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (resolvedKey) {
        requestHeaders['Authorization'] = `Bearer ${resolvedKey}`;
      }

      const res = await fetch(`${resolvedUrl}/chat/completions`, {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify({
          model: resolvedModel,
          messages: requestMessages,
          stream: true,
          temperature: apiConfig.temperature,
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        setMessages((prev) => { const u = [...prev]; const l = u[u.length - 1]; if (l.role === "assistant") l.content = `请求失败 (${res.status}): ${errText}`; return u; });
        setIsStreaming(false); return;
      }
      const reader = res.body?.getReader();
      if (!reader) { setIsStreaming(false); return; }
      const decoder = new TextDecoder();
      let accumulated = "";
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              accumulated += delta;
              setMessages((prev) => { const u = [...prev]; const l = u[u.length - 1]; if (l.role === "assistant") l.content = accumulated; return u; });
            }
          } catch {}
        }
      }
      try {
        const parsed = JSON.parse(accumulated);
        if (parsed.term || parsed.definition) {
          setMessages((prev) => { const u = [...prev]; const l = u[u.length - 1]; if (l.role === "assistant") { l.parsed = parsed; l.content = ""; } return u; });
        }
      } catch {}
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      setMessages((prev) => { const u = [...prev]; const l = u[u.length - 1]; if (l.role === "assistant") l.content = `请求异常: ${errorMsg}`; return u; });
    } finally { setIsStreaming(false); }
  }, [isStreaming, extractedText, aiContextText, epubPageText, apiConfig, userPrompt, messages]);

  const handleSend = useCallback(() => sendMessage(input), [sendMessage, input]);

  const handleVocabularySearch = useCallback(() => {
    const term = searchTerm.trim();
    if (!term) return;
    sendMessage(`请精准解释技术术语：${term}`);
    setSearchTerm("");
  }, [searchTerm, sendMessage]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    const sel = window.getSelection();
    const selectedText = sel?.toString().trim();
    if (!selectedText) return;
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, selectedText });
  }, []);

  const handleEpubRightClick = useCallback((text: string, x: number, y: number) => {
    if (!text) return;
    setContextMenu({ x, y, selectedText: text });
  }, []);

  const handleEpubTextSelected = useCallback((text: string, x: number, y: number, cfiRange: string) => {
    if (isCodeSnippet(text)) {
      setTranslatePopover({ x, y, word: text, loading: false, result: "", rectBottom: y, isCode: true });
      return;
    }
    const hasChinese = /[\u4e00-\u9fff]/.test(text);
    const hasNonChinese = /[^\u4e00-\u9fff\s]/.test(text);
    const isPureChinese = hasChinese && !hasNonChinese;
    if (isPureChinese) {
      setTranslatePopover({ x, y, word: text, loading: false, result: "", rectBottom: y, isCode: false });
      return;
    }
    setTranslatePopover({ x, y, word: text, loading: true, result: "", rectBottom: y, isCode: false });
    translateWithProvider(text, apiConfig).then((result) => {
      setTranslatePopover((p) => p ? { ...p, loading: false, result } : null);
    });
  }, [apiConfig]);

  const handleDismissPopover = useCallback(() => {
    setContextMenu(null);
    setTranslatePopover(null);
  }, []);

  const handleExplainSelection = useCallback(() => {
    if (!contextMenu) return;
    sendMessage(`请结合上下文，解释这句话的含义："${contextMenu.selectedText}"`, true);
    setContextMenu(null);
  }, [contextMenu, sendMessage]);

  const handleTranslate = useCallback(async () => {
    if (!contextMenu) return;
    const sel = window.getSelection();
    const rect = sel?.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
    const centerX = rect ? rect.left + rect.width / 2 : contextMenu.x;
    const rectTop = rect ? rect.top : contextMenu.y;
    const rectBottom = rect ? rect.bottom : contextMenu.y;
    const text = contextMenu.selectedText;
    if (isCodeSnippet(text)) {
      setTranslatePopover({
        x: centerX, y: rectTop, word: text, loading: false, result: "", rectBottom, isCode: true,
      });
      setContextMenu(null);
      return;
    }
    const hasChinese = /[\u4e00-\u9fff]/.test(text);
    const hasNonChinese = /[^\u4e00-\u9fff\s]/.test(text);
    const isPureChinese = hasChinese && !hasNonChinese;
    if (isPureChinese) {
      sendMessage(`请解释：${text}`);
      setContextMenu(null);
      return;
    }
    setTranslatePopover({
      x: centerX, y: rectTop, word: text, loading: true, result: "", rectBottom, isCode: false,
    });
    setContextMenu(null);
    const result = await translateWithProvider(text, apiConfig);
    setTranslatePopover((p) => p ? { ...p, loading: false, result } : null);
  }, [contextMenu, apiConfig, sendMessage]);

  const handlePopoverExplain = useCallback(() => {
    if (!translatePopover) return;
    sendMessage(`请解释：${translatePopover.word}`, true);
    setTranslatePopover(null);
  }, [translatePopover, sendMessage]);

  const handleStartNote = useCallback(() => {
    if (!translatePopover) return;
    setEditingNote({
      quote: translatePopover.word,
      pageNumber: activePage,
      content: "",
      isEditing: false,
    });
    setSidebarTab("notes");
    setTranslatePopover(null);
  }, [translatePopover, activePage]);

  const handleSaveEditingNote = useCallback(async () => {
    if (!editingNote || !editingNote.content.trim() || !bookId) return;
    const chapter = getCurrentChapter(editingNote.pageNumber, tocItems);
    if (editingNote.isEditing && editingNote.id) {
      const updatedNote: Note = {
        id: editingNote.id,
        pageNumber: editingNote.pageNumber,
        quote: editingNote.quote,
        content: editingNote.content.trim(),
        createdAt: Date.now(),
        chapter,
      };
      const updated = await updateNote(bookId, updatedNote);
      setNotes(updated);
    } else {
      const note: Note = {
        id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        pageNumber: editingNote.pageNumber,
        quote: editingNote.quote,
        content: editingNote.content.trim(),
        createdAt: Date.now(),
        chapter,
      };
      const updated = await saveNote(bookId, note);
      setNotes(updated);
    }
    setEditingNote(null);
  }, [editingNote, bookId, tocItems]);

  const handleEditNote = useCallback((note: Note) => {
    setEditingNote({
      id: note.id,
      quote: note.quote,
      pageNumber: note.pageNumber,
      content: note.content,
      isEditing: true,
    });
  }, []);

  const handleExportObsidian = useCallback(() => {
    if (!bookTitle || notes.length === 0) return;
    let md = `# 《${bookTitle}》的读书笔记\n`;
    md += `导出时间：${new Date().toLocaleDateString("zh-CN")}\n\n---\n\n`;
    [...notes].reverse().forEach((note) => {
      const ch = note.chapter || "";
      md += `## [${ch}] - 第 ${note.pageNumber} 页\n`;
      md += `> ${note.quote}\n\n`;
      md += `**我的思考**：\n${note.content}\n\n`;
      md += `[📍 在 AI 阅读器中打开](http://localhost:3000/reader/${bookId}?page=${note.pageNumber})\n\n---\n\n`;
    });
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${bookTitle}-读书笔记.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [bookTitle, notes, bookId]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  useEffect(() => {
    const handleClick = () => { handleDismissPopover(); setAiContextMenu(null); };
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [handleDismissPopover]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleDismissPopover();
    };
    const handleDismissEvent = () => handleDismissPopover();
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('epub-dismiss-popover', handleDismissEvent);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('epub-dismiss-popover', handleDismissEvent);
    };
  }, [handleDismissPopover]);

  useEffect(() => {
    const onEpubTextSelect = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.text) {
        handleEpubTextSelected(detail.text, detail.x, detail.y, '');
      }
    };
    const onEpubContextMenu = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.text) {
        handleEpubRightClick(detail.text, detail.x, detail.y);
      }
    };
    window.addEventListener('epub-text-select', onEpubTextSelect);
    window.addEventListener('epub-context-menu', onEpubContextMenu);
    return () => {
      window.removeEventListener('epub-text-select', onEpubTextSelect);
      window.removeEventListener('epub-context-menu', onEpubContextMenu);
    };
  }, [handleEpubTextSelected, handleEpubRightClick]);

  useEffect(() => {
    if (!translatePopover || !translatePopoverRef.current) return;
    const el = translatePopoverRef.current;
    const popoverRect = el.getBoundingClientRect();
    const popoverH = popoverRect.height;
    const popoverW = popoverRect.width;
    const gap = 8;
    let left = translatePopover.x - popoverW / 2;
    let top = translatePopover.y - popoverH - gap;
    const scrollY = window.scrollY;
    if (top < scrollY) {
      top = translatePopover.rectBottom + gap;
    }
    if (left < 10) left = 10;
    if (left + popoverW > window.innerWidth - 10) left = window.innerWidth - popoverW - 10;
    if (top !== translatePopover.y || left + popoverW / 2 !== translatePopover.x) {
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    }
  }, [translatePopover]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      setLeftRatio(Math.max(0.3, Math.min(0.8, e.clientX / window.innerWidth)));
    };
    const onUp = () => {
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  useEffect(() => {
    return () => {
      pdfDocRef.current = null;
    };
  }, []);

  useEffect(() => {
    setPageInput(String(currentPage));
  }, [currentPage]);

  useEffect(() => {
    if (pageMarkers.length === 0 || !extractedText) {
      setAiContextText("");
      return;
    }
    const startPage = Math.max(1, activePage - 1);
    const endPage = Math.min(pageMarkers.length, activePage + 1);
    const startIdx = pageMarkers[startPage - 1];
    const endIdx = endPage < pageMarkers.length ? pageMarkers[endPage] : extractedText.length;
    const raw = extractedText.slice(startIdx, endIdx);
    const lines = raw.split("\n").filter(Boolean);
    const unique = Array.from(new Set(lines));
    setAiContextText(unique.join("\n"));
  }, [activePage, pageMarkers, extractedText]);

  useEffect(() => {
    if (bookFormat !== "pdf" || !bookId || totalPages === 0) return;
    updateBookProgress(bookId, activePage, totalPages);
  }, [bookFormat, activePage, totalPages, bookId]);

  if (isLoading) return <div className="flex h-full items-center justify-center bg-[var(--background)]"><Loader2 size={24} className="animate-spin text-[var(--text-muted)]" /></div>;
  if (notFound) return <div className="flex h-full flex-col items-center justify-center gap-4 bg-[var(--background)]"><p className="text-[var(--text-muted)]">书籍未找到</p><button onClick={() => router.push("/")} className="cursor-pointer rounded-lg border border-[var(--panel-border)] px-4 py-2 text-sm text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]">返回书架</button></div>;
  if (fileMissing) return <div className="flex h-full flex-col items-center justify-center gap-4 bg-[var(--background)]"><p className="text-red-400">文件数据丢失，请返回书架重新上传该书</p><button onClick={() => router.push("/")} className="cursor-pointer rounded-lg border border-[var(--panel-border)] px-4 py-2 text-sm text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]">返回书架</button></div>;
  if (!isPrefsLoaded) return (
    <div className="flex h-screen w-full items-center justify-center bg-zinc-950 text-zinc-500">
      正在加载个人阅读偏好...
    </div>
  );

  const leftPct = `${Math.round(leftRatio * 100)}%`;
  const rightPct = `${Math.round((1 - leftRatio) * 100)}%`;
  const leftPanelWidth = isSidebarOpen
    ? (showToc && tocItems.length > 0 ? `calc(${leftPct} - 224px)` : leftPct)
    : "100%";

  return (
    <div className="flex h-full">
      {showToc && tocItems.length > 0 && (
        <div className="flex w-56 shrink-0 flex-col border-r border-[var(--panel-border)] bg-[#0d0d0d]">
          <div className="flex items-center justify-between border-b border-[var(--panel-border)] px-4 py-3">
            <span className="text-xs font-medium text-[var(--text-muted)]">目录</span>
            <button onClick={() => setShowToc(false)} className="cursor-pointer rounded p-1 text-[var(--text-muted)] transition-colors hover:bg-white/5"><PanelRightClose size={14} /></button>
          </div>
          <div className="flex-1 overflow-y-auto py-2">
            {bookFormat === "pdf" && tocItems.map((item, i) => (
              <button key={i} onClick={() => { pdfViewerRef.current?.scrollToPage(item.page || 1); setShowToc(false); }} className="w-full cursor-pointer px-4 py-1.5 text-left text-sm transition-colors hover:bg-white/5" style={{ paddingLeft: `${12 + item.level * 16}px` }}>
                <span className="text-[var(--text-secondary)] hover:text-[var(--foreground)]">{item.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={`flex min-w-0 flex-col ${fontFamily}`} style={{ width: leftPanelWidth, backgroundColor: THEMES[theme].bg, ...THEME_VARS[theme] as Record<string, string> }}>
        <div className="flex items-center gap-2 border-b border-[var(--panel-border)] px-4 py-3">
          <button onClick={() => router.push("/")} className="flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--accent)]"><ArrowLeft size={14} />书架</button>
          <input ref={fileInputRef} type="file" accept=".pdf,.epub,.txt" className="hidden" onChange={handleFileChange} />
          <button onClick={handleUploadClick} className="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--panel-border)] bg-[var(--input-bg)] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"><Upload size={14} />上传</button>
          {tocItems.length > 0 && (
            <button onClick={() => setShowToc((v) => !v)} className="flex cursor-pointer items-center gap-1 rounded-lg border border-[var(--panel-border)] bg-[var(--input-bg)] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"><List size={14} />目录</button>
          )}
          <button onClick={handleDeleteBook} className="flex cursor-pointer items-center gap-1 rounded-lg border border-[var(--panel-border)] bg-[var(--input-bg)] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:border-red-500 hover:text-red-400"><Trash2 size={14} />删除</button>
          <select value={fontFamily} onChange={(e) => setFontFamily(e.target.value as "font-sans" | "font-serif" | "font-mono")} className="cursor-pointer rounded-lg border border-[var(--panel-border)] bg-[var(--input-bg)] px-2 py-1.5 text-xs text-[var(--text-secondary)] outline-none transition-colors hover:border-[var(--accent)]">
            <option value="font-sans">Sans</option>
            <option value="font-serif">Serif</option>
            <option value="font-mono">Mono</option>
          </select>
          <div className="flex items-center gap-1.5 mx-2">
            {(Object.keys(THEMES) as ThemeKey[]).map((key) => (
              <button
                key={key}
                onClick={() => handleThemeChange(key)}
                className={`h-5 w-5 rounded-full cursor-pointer border-2 transition-all ${theme === key ? "border-white scale-110" : "border-transparent"}`}
                style={{ backgroundColor: THEMES[key].bg }}
                title={THEMES[key].name}
              />
            ))}
          </div>

          <div className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
            <button onClick={() => changeFontSize(-2)} className="flex cursor-pointer items-center rounded px-1.5 py-1 font-bold transition-colors hover:text-[var(--foreground)]" title="缩小字号">A-</button>
            <span className="w-8 text-center tabular-nums">{fontSize}px</span>
            <button onClick={() => changeFontSize(2)} className="flex cursor-pointer items-center rounded px-1.5 py-1 font-bold transition-colors hover:text-[var(--foreground)]" title="放大字号">A+</button>
          </div>

          <button onClick={() => setShowSettings(true)} className="flex cursor-pointer items-center rounded-lg px-2 py-1.5 text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--accent)]" title="AI 设置"><Settings size={14} /></button>

          {bookFormat === "pdf" && totalPages > 0 && (
            <div className="ml-auto flex items-center gap-2 text-xs text-[var(--text-muted)]">
              <button onClick={() => setZoom((z) => Math.max(0.5, z - 0.2))} className="cursor-pointer rounded p-0.5 transition-colors hover:text-[var(--foreground)]"><ZoomOut size={14} /></button>
              <span className="w-10 text-center">{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom((z) => Math.min(3, z + 0.2))} className="cursor-pointer rounded p-0.5 transition-colors hover:text-[var(--foreground)]"><ZoomIn size={14} /></button>
              <div className="mx-2 h-4 w-px bg-[var(--panel-border)]" />
              <button onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1} className="cursor-pointer rounded p-0.5 transition-colors hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-30"><ChevronLeft size={14} /></button>
              <input
                value={pageInput}
                onChange={(e) => setPageInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const p = parseInt(pageInput, 10);
                    if (p >= 1 && p <= totalPages) {
                      pdfViewerRef.current?.scrollToPage(p);
                    }
                    setPageInput(String(currentPage));
                  }
                }}
                onBlur={() => setPageInput(String(currentPage))}
                className="w-8 bg-transparent text-center text-xs text-[var(--text-muted)] outline-none focus:text-[var(--foreground)]"
              />
              <span className="text-xs text-[var(--text-muted)]">/ {totalPages}</span>
              <button onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= totalPages} className="cursor-pointer rounded p-0.5 transition-colors hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-30"><ChevronRight size={14} /></button>
            </div>
          )}

          <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]" style={{ marginLeft: bookFormat === "pdf" && totalPages > 0 ? "12px" : "auto" }}><BookOpen size={12} /><span className="max-w-28 truncate">{bookTitle}</span></div>
          <button onClick={() => setIsSidebarOpen((prev) => !prev)} className="flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--accent)]" title={isSidebarOpen ? "收起侧边栏 (Ctrl+B)" : "展开侧边栏 (Ctrl+B)"}>{isSidebarOpen ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}</button>
        </div>

        {totalPages > 0 && (
          <div className="h-0.5 w-full bg-gray-800">
            <div
              className="h-full bg-emerald-500 transition-all duration-300"
              style={{ width: `${Math.round((activePage / totalPages) * 100)}%` }}
            />
          </div>
        )}

        {/* PDF Canvas — react-pdf via PDFViewer */}
        {bookFormat === "pdf" && (
          pdfData ? (
            <PDFViewer
                ref={pdfViewerRef}
                pdfData={pdfData}
                zoom={zoom}
                onLoadSuccess={handleLoadSuccess}
                onContextMenu={handleContextMenu}
                onPageChange={handlePageChange}
                onTextSelect={handleTextSelect}
                onActivePageChange={handleActivePageChange}
                fontFamily={fontFamily}
                initialProgress={initialProgress}
              />
          ) : (
            <div className="flex-1 h-full w-full flex items-center justify-center bg-gray-900">
              <div className="text-white/50 text-sm">加载 PDF 数据中...</div>
            </div>
          )
        )}

        {/* EPUB Render via EpubViewer */}
        {bookFormat === "epub" && (
          pdfData ? (
            <EpubViewer
              fileData={pdfData}
              theme={theme === "sepia" ? "light" : theme}
              fontSize={fontSize}
              bookId={bookId}
              initialCfi={initialCfi || undefined}
              onProgress={handleEpubProgress}
              onTextExtracted={handleEpubTextExtracted}
            />
          ) : (
            <div className="flex-1 h-full w-full flex items-center justify-center bg-gray-900">
              <div className="text-white/50 text-sm">加载 EPUB 数据中...</div>
            </div>
          )
        )}

        {/* TXT Render */}
        {bookFormat === "txt" && (
          <div className="flex-1 overflow-y-auto whitespace-pre-wrap p-8 text-sm leading-relaxed font-serif" style={{ color: THEMES[theme].text, backgroundColor: THEMES[theme].bg, fontSize: `${fontSize}px`, lineHeight: "1.6" }}>
            {extractedText}
          </div>
        )}
      </div>

      {isSidebarOpen && (
        <div className="flex shrink-0 cursor-col-resize items-center justify-center bg-[var(--panel-border)] transition-colors hover:bg-[var(--accent)]" onMouseDown={() => { isDragging.current = true; document.body.style.cursor = "col-resize"; document.body.style.userSelect = "none"; }} style={{ width: 4 }}><GripVertical size={10} className="text-[var(--text-muted)]" /></div>
      )}

      {isSidebarOpen && (
      <div className="flex min-w-0 flex-col bg-[var(--panel-bg)]" style={{ width: rightPct }}>
        <div className="flex border-b border-[var(--panel-border)]">
          <button onClick={() => setSidebarTab("chat")} className={`flex cursor-pointer items-center gap-1.5 px-5 py-2.5 text-xs font-medium transition-colors ${sidebarTab === "chat" ? "border-b-2 border-[var(--accent)] text-[var(--accent)]" : "text-[var(--text-muted)] hover:text-[var(--foreground)]"}`}><Bot size={14} />AI 助理</button>
          <button onClick={() => setSidebarTab("notes")} className={`flex cursor-pointer items-center gap-1.5 px-5 py-2.5 text-xs font-medium transition-colors ${sidebarTab === "notes" ? "border-b-2 border-amber-500 text-amber-400" : "text-[var(--text-muted)] hover:text-[var(--foreground)]"}`}><StickyNote size={14} />图书笔记{notes.length > 0 ? <span className="ml-0.5 rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-400">{notes.length}</span> : null}</button>
        </div>

        {sidebarTab === "chat" && (
          <>
            <div className="flex items-center justify-between border-b border-[var(--panel-border)] px-5 py-3">
              <div className="flex items-center gap-2"><Bot size={16} className="text-[var(--accent)]" /><span className="text-sm font-medium">AI 读书助理</span></div>
              <div className="flex items-center gap-1">
                <button onClick={() => setShowConfig((v) => !v)} className={`flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-xs transition-colors ${showConfig ? 'text-[var(--accent)] bg-[var(--accent)]/10' : 'text-[var(--text-muted)] hover:text-[var(--foreground)]'}`} title="AI 提供商配置"><Settings size={13} />配置</button>
                <button onClick={handleClearChat} className="flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-xs text-[var(--text-muted)] transition-colors hover:text-red-400" title="清空当前对话"><Trash2 size={13} />清空</button>
              </div>
            </div>
            <div className="border-b border-[var(--panel-border)] px-5 py-2">
              <div className="flex items-center gap-2 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-1.5 transition-colors focus-within:border-[var(--accent)]">
                <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleVocabularySearch(); } }} placeholder="查询词汇/术语（如：虚拟内存）" className="min-w-0 flex-1 bg-transparent text-xs text-[var(--foreground)] outline-none placeholder:text-[var(--text-muted)]" />
                <button onClick={handleVocabularySearch} className="flex cursor-pointer items-center justify-center rounded p-1 text-[var(--text-muted)] transition-colors hover:text-[var(--accent)]"><Search size={13} /></button>
              </div>
            </div>
            {showConfig && (
              <div className="border-b border-[var(--panel-border)] px-5 py-3 space-y-3">
                <div className="flex items-center gap-2 rounded-lg border border-[var(--panel-border)] bg-[var(--input-bg)] p-0.5">
                  <button onClick={() => setApiConfig((prev) => ({ ...prev, engineMode: 'cloud' }))} className={`flex-1 cursor-pointer rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${apiConfig.engineMode === 'cloud' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--foreground)]'}`}>☁️ 云端</button>
                  <button onClick={() => setApiConfig((prev) => ({ ...prev, engineMode: 'local' }))} className={`flex-1 cursor-pointer rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${apiConfig.engineMode === 'local' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--foreground)]'}`}>💻 本地</button>
                </div>
                <div className="flex items-center justify-between px-1">
                  <label className="text-[11px] text-[var(--text-muted)]">Temperature</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min="0"
                      max="2.0"
                      step="0.1"
                      value={apiConfig.temperature}
                      onChange={(e) => setApiConfig((prev) => ({ ...prev, temperature: parseFloat(e.target.value) }))}
                      className="w-20 h-1.5 cursor-pointer appearance-none rounded-full bg-[var(--panel-border)] accent-[var(--accent)] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--accent)]"
                    />
                    <span className="min-w-[2.5rem] text-right text-[11px] text-[var(--text-muted)] tabular-nums">{apiConfig.temperature.toFixed(1)}</span>
                  </div>
                </div>
                <select
                  value={identityId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setIdentityId(id);
                    setUserPrompt(AI_IDENTITIES[id].prompt);
                  }}
                  className="w-full cursor-pointer rounded-lg border border-[var(--panel-border)] bg-[var(--input-bg)] px-3 py-2 text-xs text-[var(--foreground)] outline-none transition-colors focus:border-[var(--accent)]"
                >
                  {Object.entries(AI_IDENTITIES).map(([key, preset]) => (
                    <option key={key} value={key}>{preset.name}</option>
                  ))}
                </select>
                <textarea
                  value={userPrompt}
                  onChange={(e) => setUserPrompt(e.target.value)}
                  placeholder="自定义系统提示词..."
                  rows={4}
                  className="w-full resize-none rounded-lg border border-[var(--panel-border)] bg-[var(--input-bg)] px-3 py-2 text-xs text-[var(--foreground)] outline-none transition-colors focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
                />
                {apiConfig.engineMode === 'cloud' && (
                  <>
                    <select
                      value={apiConfig.cloud.currentProvider}
                      onChange={(e) => setApiConfig((prev) => ({ ...prev, cloud: { ...prev.cloud, currentProvider: e.target.value } }))}
                      className="w-full cursor-pointer rounded-lg border border-[var(--panel-border)] bg-[var(--input-bg)] px-3 py-2 text-xs text-[var(--foreground)] outline-none transition-colors focus:border-[var(--accent)]"
                    >
                      {Object.entries(PROVIDER_PRESETS).map(([key, preset]) => (
                        <option key={key} value={key}>{preset.name}</option>
                      ))}
                    </select>
                    <input
                      type="password"
                      value={apiConfig.cloud.keys[apiConfig.cloud.currentProvider] || ''}
                      onChange={(e) => setApiConfig((prev) => ({
                        ...prev,
                        cloud: {
                          ...prev.cloud,
                          keys: { ...prev.cloud.keys, [prev.cloud.currentProvider]: e.target.value },
                        },
                      }))}
                      placeholder={`输入 ${PROVIDER_PRESETS[apiConfig.cloud.currentProvider]?.name || ''} API Key`}
                      className="w-full rounded-lg border border-[var(--panel-border)] bg-[var(--input-bg)] px-3 py-2 text-xs text-[var(--foreground)] outline-none transition-colors focus:border-[var(--accent)]"
                    />
                    {apiConfig.cloud.currentProvider === 'custom' && (
                      <>
                        <input
                          type="text"
                          value={apiConfig.cloud.customUrl}
                          onChange={(e) => setApiConfig((prev) => ({ ...prev, cloud: { ...prev.cloud, customUrl: e.target.value } }))}
                          placeholder="自定义 API 地址 (如 https://your-proxy.com/v1)"
                          className="w-full rounded-lg border border-[var(--panel-border)] bg-[var(--input-bg)] px-3 py-2 text-xs text-[var(--foreground)] outline-none transition-colors focus:border-[var(--accent)]"
                        />
                        <input
                          type="text"
                          value={apiConfig.cloud.customModel}
                          onChange={(e) => setApiConfig((prev) => ({ ...prev, cloud: { ...prev.cloud, customModel: e.target.value } }))}
                          placeholder="自定义模型名称"
                          className="w-full rounded-lg border border-[var(--panel-border)] bg-[var(--input-bg)] px-3 py-2 text-xs text-[var(--foreground)] outline-none transition-colors focus:border-[var(--accent)]"
                        />
                      </>
                    )}
                  </>
                )}
                {apiConfig.engineMode === 'local' && (
                  <>
                    <input
                      type="text"
                      value={apiConfig.local.url}
                      onChange={(e) => setApiConfig((prev) => ({ ...prev, local: { ...prev.local, url: e.target.value } }))}
                      placeholder="Ollama 地址"
                      className="w-full rounded-lg border border-[var(--panel-border)] bg-[var(--input-bg)] px-3 py-2 text-xs text-[var(--foreground)] outline-none transition-colors focus:border-[var(--accent)]"
                    />
                    <input
                      type="text"
                      value={apiConfig.local.model}
                      onChange={(e) => setApiConfig((prev) => ({ ...prev, local: { ...prev.local, model: e.target.value } }))}
                      placeholder="本地模型名称"
                      className="w-full rounded-lg border border-[var(--panel-border)] bg-[var(--input-bg)] px-3 py-2 text-xs text-[var(--foreground)] outline-none transition-colors focus:border-[var(--accent)]"
                    />
                  </>
                )}
              </div>
            )}
            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
              {messages.length === 0 && <div className="flex h-full flex-col items-center justify-center gap-2 text-[var(--text-muted)]"><Bot size={24} className="opacity-30" /><p className="text-xs">开始提问，AI 将基于当前页面内容回答</p></div>}
              {messages.filter(msg => msg.role !== 'system').map((msg, i) => (
                <div key={i} className="flex gap-3">
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${msg.role === "user" ? "bg-blue-500/20 text-blue-400" : "bg-emerald-500/20 text-emerald-400"}`}>
                    {msg.role === "user" ? <User size={15} /> : <Bot size={15} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 text-[13px] font-medium text-[var(--text-muted)]">{msg.role === "user" ? "你" : "AI 助理"}</div>
                    <div className={`rounded-2xl px-4 py-3 text-lg leading-relaxed ${msg.role === "user" ? "bg-[var(--chat-user-bg)]" : "bg-[var(--chat-ai-bg)]"} text-[var(--foreground)]`}>
                      {msg.parsed ? (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2"><span className="rounded bg-[var(--accent)]/20 px-2 py-0.5 text-xs font-bold text-[var(--accent)]">{msg.parsed.term}</span></div>
                          <p className="text-lg">{msg.parsed.definition}</p>
                          <div className="border-t border-[var(--panel-border)] pt-1.5 text-[13px] text-[var(--text-muted)]">
                            <p><span className="font-medium text-[var(--foreground)]">核心本质</span>：{msg.parsed.essence}</p>
                            <p className="mt-0.5"><span className="font-medium text-[var(--foreground)]">当前语境</span>：{msg.parsed.context}</p>
                          </div>
                        </div>
                      ) : msg.content ? <div className="text-zinc-300 text-sm leading-relaxed whitespace-pre-wrap select-text pr-2" dangerouslySetInnerHTML={{ __html: memoizedHtmlContents[i] }} onContextMenu={(e) => { const selection = window.getSelection(); const selectedText = selection ? selection.toString().trim() : ''; if (selectedText) { e.preventDefault(); setAiContextMenu({ x: e.clientX, y: e.clientY, text: selectedText }); } }} /> : <span className="inline-flex items-center gap-1"><Loader2 size={14} className="animate-spin text-[var(--text-muted)]" /><span className="text-[var(--text-muted)]">思考中...</span></span>}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <div className="border-t border-[var(--panel-border)] px-5 py-4">
              <div className="flex items-center gap-2 rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-4 py-2.5 transition-colors focus-within:border-[var(--accent)]">
                <input type="text" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }} placeholder="输入你的问题..." disabled={isStreaming} className="min-w-0 flex-1 bg-transparent text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--text-muted)] disabled:opacity-50" />
                <button onClick={handleSend} disabled={isStreaming || !input.trim()} className="flex cursor-pointer items-center justify-center rounded-lg p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--accent)] hover:text-white disabled:cursor-not-allowed disabled:opacity-40">
                  {isStreaming ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                </button>
              </div>
            </div>
          </>
        )}

        {sidebarTab === "notes" && (
          <div className="flex-1 overflow-y-auto px-5 py-5">
            {returnToPage && (
              <div className="mb-3 flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
                <span className="text-xs text-emerald-400">已跳转到笔记位置</span>
                <button onClick={() => { pdfViewerRef.current?.scrollToPage(returnToPage); setReturnToPage(null); }} className="flex cursor-pointer items-center gap-1 rounded bg-emerald-500/20 px-2 py-1 text-[10px] text-emerald-400 transition-colors hover:bg-emerald-500/30"><ArrowUpRight size={10} />返回 P. {returnToPage}</button>
              </div>
            )}
            {editingNote && (
              <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
                <div className="mb-2 flex items-center gap-2"><StickyNote size={14} className="text-amber-400" /><span className="text-xs font-medium text-amber-400">{editingNote.isEditing ? "编辑笔记" : "新建笔记"}</span></div>
                <p className="mb-2 border-l-2 border-amber-500/30 pl-2 text-xs italic text-[var(--text-muted)]">“{editingNote.quote}”</p>
                <textarea value={editingNote.content} onChange={(e) => setEditingNote({ ...editingNote, content: e.target.value })} placeholder="写下你的想法..." className="mb-3 min-h-[80px] w-full resize-none rounded-lg border border-[var(--panel-border)] bg-[#0d0d0d] p-3 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--text-muted)] transition-colors focus:border-amber-500/50" />
                <div className="flex items-center justify-end gap-2">
                  <button onClick={() => setEditingNote(null)} className="cursor-pointer rounded-lg px-3 py-1.5 text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--foreground)]">取消</button>
                  <button onClick={handleSaveEditingNote} className="flex cursor-pointer items-center gap-1 rounded-lg bg-amber-500 px-3 py-1.5 text-xs text-white transition-colors hover:bg-amber-600"><Bookmark size={12} />{editingNote.isEditing ? "更新笔记" : "保存笔记"}</button>
                </div>
              </div>
            )}
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-medium text-[var(--text-muted)]">共 {notes.length} 条笔记</span>
              {notes.length > 0 && (
                <button onClick={handleExportObsidian} className="flex cursor-pointer items-center gap-1 rounded-lg border border-[var(--panel-border)] px-2.5 py-1 text-[10px] text-[var(--text-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"><Download size={11} />导出到 Obsidian</button>
              )}
            </div>
            {notes.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-[var(--text-muted)]"><StickyNote size={24} className="opacity-30" /><p className="text-xs">暂无笔记</p><p className="text-[10px] text-[var(--text-muted)]/50">划词后点击「添加笔记」按钮</p></div>
            ) : (
              <div className="space-y-3">
                {[...notes].reverse().map((note) => (
                  <div key={note.id} className="group cursor-pointer rounded-xl border border-[var(--panel-border)] bg-[var(--chat-ai-bg)] p-4 transition-colors hover:border-amber-500/40" onClick={() => { setReturnToPage(activePage); pdfViewerRef.current?.scrollToPage(note.pageNumber); }}>
                    <div className="mb-2 flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <span className="rounded bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400">P. {note.pageNumber}</span>
                        {note.chapter && <span className="text-[10px] text-[var(--text-muted)]">| {note.chapter}</span>}
                      </span>
                      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <button onClick={(e) => { e.stopPropagation(); handleEditNote(note); }} className="cursor-pointer rounded p-1 text-[var(--text-muted)] transition-colors hover:text-amber-400"><Edit size={12} /></button>
                        <button onClick={(e) => { e.stopPropagation(); deleteNote(bookId!, note.id).then(setNotes); }} className="cursor-pointer rounded p-1 text-[var(--text-muted)] transition-colors hover:text-red-400"><Trash2 size={12} /></button>
                      </div>
                    </div>
                    <p className="mb-2 border-l-2 border-[var(--panel-border)] pl-2 text-xs italic text-[var(--text-muted)]">“{note.quote}”</p>
                    <p className="text-sm leading-relaxed text-[var(--foreground)]">{note.content}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      )}

      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowSettings(false)}>
          <div className="w-full max-w-md rounded-xl border border-[var(--panel-border)] bg-[#1a1a1a] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-5 flex items-center justify-between">
              <span className="text-sm font-medium text-[var(--foreground)]">AI 引擎配置</span>
              <button onClick={() => setShowSettings(false)} className="cursor-pointer rounded p-1 text-[var(--text-muted)] transition-colors hover:text-[var(--foreground)]"><Settings size={16} /></button>
            </div>

            <div className="mb-5 flex rounded-lg border border-[var(--panel-border)] p-0.5">
              <button onClick={() => setApiConfig((prev) => ({ ...prev, engineMode: 'cloud' }))} className={`flex-1 cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${apiConfig.engineMode === 'cloud' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--foreground)]'}`}>☁️ 云端大模型</button>
              <button onClick={() => setApiConfig((prev) => ({ ...prev, engineMode: 'local' }))} className={`flex-1 cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${apiConfig.engineMode === 'local' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--foreground)]'}`}>💻 本地算力 (Ollama)</button>
            </div>

            <div className="space-y-3">
              {apiConfig.engineMode === 'cloud' && (
                <div>
                  <label className="mb-1 block text-xs text-[var(--text-muted)]">提供商</label>
                  <select
                    value={apiConfig.cloud.currentProvider}
                    onChange={(e) => setApiConfig((prev) => ({ ...prev, cloud: { ...prev.cloud, currentProvider: e.target.value } }))}
                    className="w-full cursor-pointer rounded-lg border border-[var(--panel-border)] bg-[#0d0d0d] px-3 py-2 text-xs text-[var(--foreground)] outline-none transition-colors focus:border-[var(--accent)]"
                  >
                    {Object.entries(PROVIDER_PRESETS).map(([key, preset]) => (
                      <option key={key} value={key}>{preset.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="mb-1 block text-xs text-[var(--text-muted)]">API 地址</label>
                <input
                  type="text"
                  value={apiConfig.engineMode === 'cloud' ? apiConfig.cloud.customUrl : apiConfig.local.url}
                  onChange={(e) => setApiConfig((prev) => apiConfig.engineMode === 'cloud'
                    ? { ...prev, cloud: { ...prev.cloud, customUrl: e.target.value } }
                    : { ...prev, local: { ...prev.local, url: e.target.value } })}
                  placeholder={apiConfig.engineMode === 'cloud' ? PROVIDER_PRESETS[apiConfig.cloud.currentProvider]?.url : "http://localhost:11434/v1"}
                  className="w-full rounded-lg border border-[var(--panel-border)] bg-[#0d0d0d] px-3 py-2 text-xs text-[var(--foreground)] outline-none transition-colors focus:border-[var(--accent)]"
                />
              </div>

              {apiConfig.engineMode === 'cloud' && (
                <div>
                  <label className="mb-1 block text-xs text-[var(--text-muted)]">API Key</label>
                  <input
                    type="password"
                    value={apiConfig.cloud.keys[apiConfig.cloud.currentProvider] || ""}
                    onChange={(e) => setApiConfig((prev) => ({
                      ...prev,
                      cloud: {
                        ...prev.cloud,
                        keys: { ...prev.cloud.keys, [prev.cloud.currentProvider]: e.target.value },
                      },
                    }))}
                    className="w-full rounded-lg border border-[var(--panel-border)] bg-[#0d0d0d] px-3 py-2 text-xs text-[var(--foreground)] outline-none transition-colors focus:border-[var(--accent)]"
                  />
                </div>
              )}

              <div>
                <label className="mb-1 block text-xs text-[var(--text-muted)]">模型名称</label>
                <input
                  type="text"
                  value={apiConfig.engineMode === 'cloud' ? apiConfig.cloud.customModel : apiConfig.local.model}
                  onChange={(e) => setApiConfig((prev) => apiConfig.engineMode === 'cloud'
                    ? { ...prev, cloud: { ...prev.cloud, customModel: e.target.value } }
                    : { ...prev, local: { ...prev.local, model: e.target.value } })}
                  placeholder={apiConfig.engineMode === 'cloud' ? PROVIDER_PRESETS[apiConfig.cloud.currentProvider]?.model : "qwen2.5"}
                  className="w-full rounded-lg border border-[var(--panel-border)] bg-[#0d0d0d] px-3 py-2 text-xs text-[var(--foreground)] outline-none transition-colors focus:border-[var(--accent)]"
                />
              </div>

              {apiConfig.engineMode === 'local' && (
                <p className="text-[10px] text-[var(--text-muted)]/60">需在本地运行 Ollama 等兼容服务</p>
              )}
            </div>
          </div>
        </div>
      )}

      {contextMenu && (
        <div className="context-menu fixed z-50 min-w-36 rounded-xl border border-[var(--panel-border)] bg-[#1a1a1a] py-1 shadow-2xl" style={{ left: contextMenu.x, top: contextMenu.y }}>
          <button onClick={handleExplainSelection} className="flex w-full cursor-pointer items-center gap-2 px-4 py-2 text-sm text-[var(--foreground)] transition-colors hover:bg-white/10"><Bot size={14} className="text-[var(--accent)]" />AI 解释</button>
          <button onClick={handleTranslate} className="flex w-full cursor-pointer items-center gap-2 px-4 py-2 text-sm text-[var(--foreground)] transition-colors hover:bg-white/10"><BookOpen size={14} className="text-emerald-400" />AI 翻译</button>
        </div>
      )}

      {translatePopover && translatePopover.isCode ? (
        <div ref={translatePopoverRef} className="translate-popover fixed z-50 -translate-x-1/2 rounded-lg border border-[var(--panel-border)] shadow-2xl" style={{ left: translatePopover.x, top: translatePopover.y, maxWidth: 500, minWidth: 260 }}>
          <div className="flex items-center justify-between rounded-t-lg bg-[#2d2d2d] px-3 py-1.5 border-b border-white/10">
            <span className="text-[10px] text-white/40 font-mono tracking-wider">C</span>
            <button onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(translatePopover.word).then(() => setCopied(true)); setTimeout(() => setCopied(false), 1500); }} className="flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-white/40 transition-colors hover:text-white/80"><Copy size={11} />{copied ? "Copied!" : "Copy"}</button>
          </div>
          <pre className="m-0 overflow-x-auto rounded-b-lg p-0" style={{ background: "#2d2d2d", margin: 0 }}>
            <code id="code-highlight-content" className="language-c block p-4 text-[13px] leading-[1.6]" />
          </pre>
        </div>
      ) : translatePopover && (
        <div ref={translatePopoverRef} className="translate-popover fixed z-50 w-auto min-w-24 max-w-64 -translate-x-1/2 rounded-lg border border-[var(--panel-border)] bg-[#1a1a1a] px-3 py-2 shadow-2xl" style={{ left: translatePopover.x, top: translatePopover.y }}>
          {translatePopover.loading ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)]"><Loader2 size={12} className="animate-spin" />翻译中...</span>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              {translatePopover.result ? (
                <span className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--foreground)]">{translatePopover.result}</span>
              ) : (
                <span className="whitespace-pre-wrap text-xs text-[var(--text-muted)]">{translatePopover.word}</span>
              )}
              <button onClick={(e) => { e.stopPropagation(); handlePopoverExplain(); }} className="flex cursor-pointer items-center gap-1 rounded bg-[var(--accent)]/10 px-2 py-0.5 text-xs text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/20"><Bot size={11} />AI 解释</button>
              <button onClick={(e) => { e.stopPropagation(); handleStartNote(); }} className="flex cursor-pointer items-center gap-1 rounded bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400 transition-colors hover:bg-amber-500/20"><StickyNote size={11} />添加笔记</button>
            </div>
          )}
        </div>
      )}
      {aiContextMenu && (
        <div
          style={{ position: 'fixed', top: aiContextMenu.y, left: aiContextMenu.x, zIndex: 9999 }}
          className="bg-zinc-800 border border-zinc-700 rounded shadow-xl p-1"
        >
          <button
            className="text-xs text-zinc-200 hover:bg-zinc-700 px-3 py-1.5 rounded block w-full text-left font-sans"
            onClick={async (e) => {
              e.stopPropagation();
              const localNotes = JSON.parse(localStorage.getItem('my_reader_notes') || '[]');
              localNotes.push({
                id: Date.now().toString(),
                timestamp: new Date().toLocaleString(),
                type: 'ai_selection_snapshot',
                content: aiContextMenu.text
              });
              localStorage.setItem('my_reader_notes', JSON.stringify(localNotes));
              const chapter = getCurrentChapter(activePage, tocItems);
              const note: Note = {
                id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                pageNumber: activePage,
                quote: aiContextMenu.text,
                content: '',
                createdAt: Date.now(),
                chapter,
              };
              const updated = await saveNote(bookId!, note);
              setNotes(updated);
              setAiContextMenu(null);
              alert('已成功将选中的 AI 回答内容加入笔记！');
            }}
          >
            📁 将选中 AI 内容加入笔记
          </button>
        </div>
      )}
    </div>
  );
}
