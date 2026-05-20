"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Upload, BookOpen, Loader2, Library, Trash2, Search, Download, ArchiveRestore, AlertCircle, CheckCircle2, FileWarning } from "lucide-react";
import {
  getBooks,
  saveBooks,
  deleteBook,
  saveFileData,
  getAllNotes,
  exportLibraryData,
  importLibraryData,
  type BookMeta,
  type LibraryBackup,
} from "@/utils/storage";

const PDF_WORKER_URL = "/pdf.worker.min.mjs";

const GRADIENT_COVERS = [
  "from-slate-700 via-slate-800 to-zinc-900",
  "from-teal-900 via-slate-800 to-zinc-900",
  "from-stone-700 via-zinc-800 to-neutral-950",
  "from-indigo-900 via-slate-800 to-zinc-950",
  "from-emerald-900 via-slate-800 to-neutral-950",
  "from-zinc-700 via-stone-800 to-neutral-950",
  "from-cyan-900 via-slate-800 to-zinc-950",
  "from-neutral-700 via-zinc-800 to-stone-950",
];

const SUPPORTED_EXTENSIONS = /\.(pdf|epub|txt)$/i;

interface DesktopBookFile {
  name: string;
  path?: string;
  size: number;
  lastModified?: number;
  dataBase64: string;
}

interface ImportQueueItem {
  id: string;
  fileName: string;
  status: "queued" | "parsing" | "imported" | "skipped" | "failed";
  detail: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function makeQueueId(file: File): string {
  return `${file.name}_${file.size}_${file.lastModified}_${Math.random().toString(36).slice(2, 8)}`;
}

function base64ToFile(file: DesktopBookFile): File {
  const binary = atob(file.dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const result = new File([bytes], file.name, { lastModified: file.lastModified || Date.now() });
  if (file.path) {
    Object.defineProperty(result, "sourcePath", { value: file.path });
  }
  return result;
}

async function hashFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function getFileSourcePath(file: File): string | undefined {
  return (file as File & { sourcePath?: string }).sourcePath;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function extractTocFromText(text: string): BookMeta["tocItems"] {
  const items: BookMeta["tocItems"] = [];
  const lines = text.split("\n");
    const chapterRegex = /^(第[一二三四五六七八九十百千\d]+[章节部卷]|\d+\.\s+|#+\s+|■\s*)/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const match = line.match(chapterRegex);
    if (match) {
      let level = 0;
      if (line.startsWith("###")) level = 2;
      else if (line.startsWith("##")) level = 1;
      else if (line.startsWith("#")) level = 0;
      else if (/^第/.test(line)) level = 0;
      items.push({ title: line.replace(/^#+\s*/, ""), page: i, level });
    }
  }
  return items;
}

const flattenOutline = (
  items: Array<{ title: string; dest: string | Array<unknown> | null; items: Array<unknown> }>,
  level: number,
): BookMeta["tocItems"] => {
  const result: BookMeta["tocItems"] = [];
  for (const item of items) {
    let page = 0;
    if (item.dest && Array.isArray(item.dest)) {
      const pageRef = item.dest[0];
      if (typeof pageRef === "object" && pageRef !== null && "num" in pageRef) {
        page = (pageRef as { num: number }).num;
      }
    }
    result.push({ title: item.title, page, level });
    if (item.items && item.items.length > 0) {
      result.push(
        ...flattenOutline(
          item.items as Array<{ title: string; dest: string | Array<unknown> | null; items: Array<unknown> }>,
          level + 1,
        ),
      );
    }
  }
  return result;
};

async function extractPdfCover(url: string): Promise<string | undefined> {
  try {
    const { pdfjs: pdfjsLib } = await import("react-pdf");
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
    const pdf = await pdfjsLib.getDocument({ url }).promise;
    const page = await pdf.getPage(1);
    const targetWidth = 300;
    const viewport = page.getViewport({ scale: 1 });
    const scale = targetWidth / viewport.width;
    const scaledViewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = scaledViewport.width;
    canvas.height = scaledViewport.height;
    await page.render({ canvas, viewport: scaledViewport }).promise;
    return canvas.toDataURL("image/jpeg", 0.85);
  } catch {
    return undefined;
  }
}

export default function LibraryPage() {
  const router = useRouter();
  const [books, setBooks] = useState<BookMeta[]>([]);
  const [noteMatches, setNoteMatches] = useState<Record<string, string>>({});
  const [isUploading, setIsUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dragActive, setDragActive] = useState(false);
  const [query, setQuery] = useState("");
  const [importStatus, setImportStatus] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [importQueue, setImportQueue] = useState<ImportQueueItem[]>([]);
  const [recentBookIds, setRecentBookIds] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    Promise.all([getBooks(), getAllNotes()]).then(([data, allNotes]) => {
      setBooks(data);
      const matches: Record<string, string> = {};
      for (const item of allNotes) {
        const joined = item.notes.map((note) => `${note.quote} ${note.content}`).join(" ");
        if (joined) matches[item.bookId] = joined;
      }
      setNoteMatches(matches);
      setLoading(false);
    });
  }, []);

  const handleDelete = useCallback((e: React.MouseEvent, bookId: string) => {
    e.stopPropagation();
    deleteBook(bookId).then((updated) => {
      setBooks(updated);
    });
    localStorage.removeItem(`chat_history_${bookId}`);
  }, []);

  const updateQueueItem = useCallback((id: string, patch: Partial<ImportQueueItem>) => {
    setImportQueue((prev) => prev.map((item) => item.id === id ? { ...item, ...patch } : item));
  }, []);

  const refreshNoteMatches = useCallback(async () => {
    const allNotes = await getAllNotes();
    const matches: Record<string, string> = {};
    for (const item of allNotes) {
      const joined = item.notes.map((note) => `${note.quote} ${note.content}`).join(" ");
      if (joined) matches[item.bookId] = joined;
    }
    setNoteMatches(matches);
  }, []);

  const parseBookFile = useCallback(async (file: File, queueId: string, fileHash: string): Promise<BookMeta> => {
    if (!SUPPORTED_EXTENSIONS.test(file.name)) {
      throw new Error(`不支持的文件格式：${file.name}`);
    }

    const id = `book_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const title = file.name.replace(SUPPORTED_EXTENSIONS, "");
    const isPdf = file.name.toLowerCase().endsWith(".pdf");
    const isEpub = file.name.toLowerCase().endsWith(".epub");
    const fileType: BookMeta["fileType"] = isPdf ? "pdf" : isEpub ? "epub" : "txt";

    let content = "";
    let tocItems: BookMeta["tocItems"] = [];
    let pageMarkers: number[] = [];
    let coverImage: string | undefined;
    let storageFields: Pick<BookMeta, "storage" | "originalFileName" | "filePath"> = { storage: "indexeddb" };

    if (window.aiReaderDesktop?.isDesktop && window.aiReaderDesktop.persistBookFile) {
      try {
        const sourcePath = getFileSourcePath(file);
        const persisted = await window.aiReaderDesktop.persistBookFile({
          bookId: id,
          name: file.name,
          sourcePath,
          dataBase64: sourcePath ? undefined : await fileToBase64(file),
          fileHash,
        });
        storageFields = {
          storage: persisted.storage,
          originalFileName: persisted.originalFileName,
          filePath: persisted.filePath,
        };
      } catch (err) {
        console.warn("写入 App 数据目录失败，回退 IndexedDB:", err);
      }
    }

    if (storageFields.storage !== "appData" && fileType !== "txt") {
      await saveFileData(id, file);
    }

    const objectUrl = URL.createObjectURL(file);
    try {
      if (fileType === "txt") {
        content = await file.text();
        tocItems = extractTocFromText(content);
      } else if (fileType === "epub") {
        content = `[EPUB 文件] ${title}`;
        try {
          const ePub = (await import("epubjs")).default;
          const fileBuffer = await file.arrayBuffer();
          const book = ePub(fileBuffer);
          await book.ready;
          const coverUrl = await book.coverUrl();
          if (coverUrl) {
            const res = await fetch(coverUrl);
            const blob = await res.blob();
            coverImage = await new Promise<string>((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result as string);
              reader.readAsDataURL(blob);
            });
          }
        } catch (e) {
          console.error("书架导入期提取 EPUB 封面失败:", e);
        }
      } else {
        const { pdfjs: pdfjsLib } = await import("react-pdf");
        pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
        const pdf = await pdfjsLib.getDocument({ url: objectUrl }).promise;

        const outline = await pdf.getOutline();
        if (outline && outline.length > 0) {
          tocItems = flattenOutline(
            outline as Array<{ title: string; dest: string | Array<unknown> | null; items: Array<unknown> }>,
            0,
          );
        }

        const markers: number[] = [];
        let fullText = "";
        for (let i = 1; i <= pdf.numPages; i++) {
          const detail = `第 ${i}/${pdf.numPages} 页`;
          setImportStatus(`正在解析 ${file.name}：${detail}`);
          updateQueueItem(queueId, { status: "parsing", detail });
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          const pageText = textContent.items
            .filter((item) => "str" in item)
            .map((item) => (item as { str: string }).str)
            .join(" ");
          markers.push(fullText.length);
          fullText += `\n\n--- 第 ${i} 页 ---\n\n` + pageText;
        }
        pageMarkers = markers;
        content = fullText;

        coverImage = await extractPdfCover(objectUrl);
      }
    } finally {
      URL.revokeObjectURL(objectUrl);
    }

    return {
      id,
      title,
      author: "",
      size: file.size,
      uploadTime: Date.now(),
      content,
      fileType,
      tocItems,
      pageMarkers,
      readProgress: 0,
      currentPage: 0,
      ...storageFields,
      fileHash,
      coverImage,
    };
  }, [updateQueueItem]);

  const importFiles = useCallback(async (fileList: FileList | File[]) => {
    const allFiles = Array.from(fileList);
    const files = allFiles.filter((file) => SUPPORTED_EXTENSIONS.test(file.name));
    const rejectedCount = allFiles.length - files.length;
    if (files.length === 0) {
      setErrorMessage("请选择 PDF、EPUB 或 TXT 文件");
      return;
    }

    setIsUploading(true);
    setErrorMessage("");
    setImportStatus("");
    const queueItems = files.map((file) => ({
      id: makeQueueId(file),
      fileName: file.name,
      status: "queued" as const,
      detail: "等待导入",
    }));
    setImportQueue(queueItems);
    const imported: BookMeta[] = [];
    const skipped: string[] = [];
    const failed: string[] = [];

    try {
      let workingBooks = [...books];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const queueId = queueItems[i].id;
        setImportStatus(`正在导入 ${i + 1}/${files.length}：${file.name}`);
        updateQueueItem(queueId, { status: "parsing", detail: "计算文件指纹" });
        try {
          const fileHash = await hashFile(file);
          const title = file.name.replace(SUPPORTED_EXTENSIONS, "");
          const duplicate = workingBooks.find((book) => (
            (book.fileHash && book.fileHash === fileHash) ||
            (!book.fileHash && book.title === title && book.size === file.size)
          ));
          if (duplicate) {
            skipped.push(file.name);
            updateQueueItem(queueId, { status: "skipped", detail: `已存在：${duplicate.title}` });
            continue;
          }
          const book = await parseBookFile(file, queueId, fileHash);
          workingBooks = [...workingBooks, book];
          imported.push(book);
          setBooks(workingBooks);
          updateQueueItem(queueId, { status: "imported", detail: "导入完成" });
        } catch (err) {
          const message = err instanceof Error ? err.message : "文件解析失败";
          failed.push(`${file.name}：${message}`);
          updateQueueItem(queueId, { status: "failed", detail: message });
        }
      }
      await saveBooks(workingBooks);
      setRecentBookIds(new Set(imported.map((book) => book.id)));
      const parts = [
        imported.length > 0 ? `成功 ${imported.length} 本` : "",
        skipped.length > 0 ? `跳过 ${skipped.length} 本` : "",
        failed.length > 0 ? `失败 ${failed.length} 本` : "",
        rejectedCount > 0 ? `不支持 ${rejectedCount} 个文件` : "",
      ].filter(Boolean);
      setImportStatus(parts.length > 0 ? parts.join("，") : "没有导入新书");
      setErrorMessage(failed.length > 0 ? failed.join("；") : "");
      if (imported.length === 1) router.push(`/reader/${imported[0].id}`);
    } finally {
      setIsUploading(false);
      setTimeout(() => {
        setImportStatus("");
        setRecentBookIds(new Set());
      }, 5000);
    }
  }, [books, parseBookFile, router, updateQueueItem]);

  const handleUploadClick = useCallback(async () => {
    if (window.aiReaderDesktop?.isDesktop && window.aiReaderDesktop.selectBookFiles) {
      try {
        const selected = await window.aiReaderDesktop.selectBookFiles();
        if (selected.length > 0) {
          await importFiles(selected.map(base64ToFile));
        }
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : "无法打开系统文件选择器");
      }
      return;
    }
    fileInputRef.current?.click();
  }, [importFiles]);

  useEffect(() => {
    const handler = (event: Event) => {
      const command = (event as CustomEvent<string>).detail;
      if (command === "import-book") handleUploadClick();
      if (command === "focus-search") searchInputRef.current?.focus();
    };
    window.addEventListener("ai-reader-command", handler);
    return () => window.removeEventListener("ai-reader-command", handler);
  }, [handleUploadClick]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) await importFiles(e.target.files);
    e.target.value = "";
  };

  const handleBackupImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    setErrorMessage("");
    try {
      const backup = JSON.parse(await file.text()) as LibraryBackup;
      const restored = await importLibraryData(backup);
      setBooks(restored);
      await refreshNoteMatches();
      setImportStatus(`已恢复 ${restored.length} 本书`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "备份恢复失败");
    } finally {
      setIsUploading(false);
      e.target.value = "";
      setTimeout(() => setImportStatus(""), 2500);
    }
  };

  const handleBackupExport = async () => {
    setIsUploading(true);
    setErrorMessage("");
    try {
      const backup = await exportLibraryData();
      const blob = new Blob([JSON.stringify(backup)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ai-reader-backup-${formatDate(Date.now())}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setImportStatus("备份已导出");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "备份导出失败");
    } finally {
      setIsUploading(false);
      setTimeout(() => setImportStatus(""), 2500);
    }
  };

  const filteredBooks = books.filter((book) => {
    const term = query.trim().toLowerCase();
    if (!term) return true;
    return [
      book.title,
      book.author,
      book.content.slice(0, 80_000),
      noteMatches[book.id] || "",
    ].some((value) => value.toLowerCase().includes(term));
  });

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--background)]">
        <Loader2 size={24} className="animate-spin text-[var(--text-muted)]" />
      </div>
    );
  }

  return (
    <div
      className="relative flex h-full flex-col"
      onDragEnter={(e) => {
        e.preventDefault();
        setDragActive(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDragActive(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragActive(false);
        importFiles(e.dataTransfer.files);
      }}
    >
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--panel-border)] bg-[var(--toolbar-bg)]/95 px-8 py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--panel-border)] bg-[var(--panel-bg-elevated)] text-[var(--accent)]">
            <Library size={18} />
          </span>
          <div>
            <h1 className="text-base font-semibold">我的图书馆</h1>
            <p className="text-xs text-[var(--text-muted)]">{books.length} 本书 · 本地优先保存</p>
          </div>
        </div>
        <div className="min-w-[260px] flex-1 max-w-xl">
          <div className="flex min-h-10 items-center gap-2 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 transition-colors focus-within:border-[var(--accent)] focus-within:ring-2 focus-within:ring-[var(--focus-ring)]">
            <Search size={15} className="text-[var(--text-muted)]" />
            <input
              ref={searchInputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索书名、正文或笔记"
              aria-label="搜索书名、正文或笔记"
              className="min-w-0 flex-1 bg-transparent text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--text-muted)]"
            />
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.epub,.txt"
          multiple
          className="hidden"
          onChange={handleFileChange}
        />
        <input ref={backupInputRef} type="file" accept="application/json,.json" className="hidden" onChange={handleBackupImport} />
        <div className="flex items-center gap-2">
          <button
            onClick={handleBackupExport}
            disabled={isUploading || books.length === 0}
            className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-[var(--panel-border)] bg-[var(--panel-bg-elevated)] px-3 text-sm text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
            title="导出书库备份"
            aria-label="导出书库备份"
          >
            <Download size={15} />
          </button>
          <button
            onClick={() => backupInputRef.current?.click()}
            disabled={isUploading}
            className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-[var(--panel-border)] bg-[var(--panel-bg-elevated)] px-3 text-sm text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
            title="恢复书库备份"
            aria-label="恢复书库备份"
          >
            <ArchiveRestore size={15} />
          </button>
          <button
            onClick={handleUploadClick}
            disabled={isUploading}
            className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-[var(--accent)]/45 bg-[var(--accent)]/10 px-5 text-sm font-medium text-[var(--accent)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent)]/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isUploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            {isUploading ? "解析中..." : "添加新书"}
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-8 py-8">
        {(importStatus || errorMessage) && (
          <div className={`mb-5 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm ${errorMessage ? "border-red-500/30 bg-red-500/10 text-red-300" : "border-[var(--accent)]/30 bg-[var(--accent)]/10 text-[var(--accent)]"}`}>
            {errorMessage ? <AlertCircle size={16} /> : <Loader2 size={16} className={isUploading ? "animate-spin" : ""} />}
            <span>{errorMessage || importStatus}</span>
          </div>
        )}
        {importQueue.length > 0 && (
          <div className="mb-6 overflow-hidden rounded-lg border border-[var(--panel-border)] bg-[var(--panel-bg)]">
            <div className="flex items-center justify-between border-b border-[var(--panel-border)] px-4 py-3">
              <span className="text-xs font-medium text-[var(--text-secondary)]">导入队列</span>
              <span className="text-xs text-[var(--text-muted)]">
                {importQueue.filter((item) => item.status === "imported").length}/{importQueue.length}
              </span>
            </div>
            <div className="max-h-44 overflow-y-auto">
              {importQueue.map((item) => (
                <div key={item.id} className="flex items-center gap-3 border-b border-[var(--panel-border)] px-4 py-3 last:border-b-0">
                  {item.status === "imported" ? (
                    <CheckCircle2 size={16} className="shrink-0 text-emerald-400" />
                  ) : item.status === "failed" ? (
                    <AlertCircle size={16} className="shrink-0 text-red-400" />
                  ) : item.status === "skipped" ? (
                    <FileWarning size={16} className="shrink-0 text-amber-400" />
                  ) : (
                    <Loader2 size={16} className={`shrink-0 text-[var(--accent)] ${item.status === "parsing" ? "animate-spin" : ""}`} />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-[var(--foreground)]">{item.fileName}</p>
                    <p className="truncate text-xs text-[var(--text-muted)]">{item.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {books.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-[var(--text-muted)]">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-[var(--panel-border)] bg-[var(--panel-bg-elevated)]">
              <BookOpen size={28} className="text-[var(--accent)]" />
            </div>
            <p className="max-w-md text-center text-sm">书架空空如也。添加 PDF、EPUB 或 TXT，也可以直接拖拽文件到这里。</p>
          </div>
        ) : filteredBooks.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-[var(--text-muted)]">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--panel-border)] bg-[var(--panel-bg-elevated)]">
              <Search size={24} className="text-[var(--text-muted)]" />
            </div>
            <p className="text-sm">没有找到匹配的书籍、正文或笔记</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {filteredBooks.map((book, i) => (
              <div key={book.id} className={`group relative rounded-lg transition-shadow ${recentBookIds.has(book.id) ? "shadow-[0_0_0_2px_var(--accent)]" : ""}`}>
                <button
                  onClick={() => router.push(`/reader/${book.id}`)}
                  className="w-full cursor-pointer text-left"
                >
                  <div className="relative mb-3 aspect-[3/4] w-full overflow-hidden rounded-lg border border-[var(--panel-border)] bg-[var(--panel-bg-elevated)] shadow-[var(--shadow-soft)] transition-colors group-hover:border-[var(--accent)]/55">
                    {book.coverImage ? (
                      <img
                        src={book.coverImage}
                        alt={book.title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className={`flex h-full w-full items-center justify-center bg-gradient-to-br ${GRADIENT_COVERS[i % GRADIENT_COVERS.length]}`}>
                        <span className="text-3xl font-semibold text-white/35 select-none">
                          {book.title.slice(0, 2).toUpperCase()}
                        </span>
                      </div>
                    )}
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-3 pt-8">
                      <p className="truncate text-xs font-medium text-white/90">
                        {book.title}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <p className="truncate text-sm font-medium text-[var(--foreground)]">
                      {book.title}
                    </p>
                    <p className="text-xs text-[var(--text-muted)]">
                      {formatSize(book.size)} · {formatDate(book.uploadTime)}
                    </p>
                    <div className="flex items-center gap-2">
                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--panel-border)]">
                        <div
                          className="h-full rounded-full bg-[var(--accent)] transition-all"
                          style={{ width: `${book.readProgress}%` }}
                        />
                      </div>
                      <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">
                        {book.readProgress > 0 ? `${book.readProgress}%` : "未读"}
                      </span>
                    </div>
                  </div>
                </button>
                <button
                  onClick={(e) => handleDelete(e, book.id)}
                  className="absolute right-2 top-2 flex min-h-8 min-w-8 cursor-pointer items-center justify-center rounded-lg border border-white/10 bg-black/45 text-white/70 opacity-0 transition-colors hover:border-red-400/40 hover:bg-red-500/70 hover:text-white group-hover:opacity-100"
                  title="删除书籍"
                  aria-label={`删除 ${book.title}`}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      {dragActive && (
        <div className="pointer-events-none absolute inset-4 z-20 flex items-center justify-center rounded-2xl border border-dashed border-[var(--accent)] bg-black/70 text-[var(--foreground)] backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <Upload size={34} className="text-[var(--accent)]" />
            <span className="text-sm">松开即可导入 PDF、EPUB 或 TXT</span>
          </div>
        </div>
      )}
    </div>
  );
}
