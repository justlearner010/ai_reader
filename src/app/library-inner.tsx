"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Upload, BookOpen, Loader2, Library, Trash2 } from "lucide-react";
import { getBooks, saveBooks, deleteBook, saveFileData, type BookMeta } from "@/utils/storage";

const PDF_WORKER_URL = "/pdf.worker.min.mjs";

const GRADIENT_COVERS = [
  "from-blue-600 via-purple-600 to-pink-500",
  "from-emerald-500 via-teal-500 to-cyan-600",
  "from-orange-500 via-red-500 to-rose-600",
  "from-indigo-500 via-violet-500 to-purple-600",
  "from-amber-500 via-yellow-500 to-orange-600",
  "from-rose-500 via-pink-500 to-fuchsia-500",
  "from-sky-500 via-blue-500 to-indigo-600",
  "from-lime-500 via-green-500 to-emerald-600",
];

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
  const [isUploading, setIsUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getBooks().then((data) => {
      setBooks(data);
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

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);

    try {
      const id = `book_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const title = file.name.replace(/\.(pdf|epub|txt)$/i, "");
      const isPdf = file.name.toLowerCase().endsWith(".pdf");
      const isEpub = file.name.toLowerCase().endsWith(".epub");
      const fileType: BookMeta["fileType"] = isPdf ? "pdf" : isEpub ? "epub" : "txt";

      let content = "";
      let tocItems: BookMeta["tocItems"] = [];
      let pageMarkers: number[] = [];
      let coverImage: string | undefined;

      if (fileType !== "txt") {
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

      const book: BookMeta = {
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
        coverImage,
      };

      const updated = [...books, book];
      setBooks(updated);
      await saveBooks(updated);
      router.push(`/reader/${id}`);
    } catch (err) {
      console.error("文件解析失败:", err);
    } finally {
      setIsUploading(false);
    }

    e.target.value = "";
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--background)]">
        <Loader2 size={24} className="animate-spin text-[var(--text-muted)]" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-[var(--panel-border)] px-8 py-5">
        <div className="flex items-center gap-3">
          <Library size={22} className="text-[var(--accent)]" />
          <h1 className="text-lg font-semibold tracking-wide">我的图书馆</h1>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.epub,.txt"
          className="hidden"
          onChange={handleFileChange}
        />
        <button
          onClick={handleUploadClick}
          disabled={isUploading}
          className="flex cursor-pointer items-center gap-2 rounded-xl border border-[var(--panel-border)] bg-[var(--input-bg)] px-5 py-2.5 text-sm text-[var(--text-secondary)] transition-all hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isUploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
          {isUploading ? "解析中..." : "添加新书"}
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-8 py-8">
        {books.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-[var(--text-muted)]">
            <BookOpen size={48} className="opacity-30" />
            <p className="text-sm">书架空空如也，点击右上角添加你的第一本书</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {books.map((book, i) => (
              <div key={book.id} className="group relative">
                <button
                  onClick={() => router.push(`/reader/${book.id}`)}
                  className="w-full cursor-pointer text-left transition-transform hover:-translate-y-1"
                >
                  <div className="relative mb-3 aspect-[3/4] w-full overflow-hidden rounded-xl shadow-lg transition-shadow group-hover:shadow-xl">
                    {book.coverImage ? (
                      <img
                        src={book.coverImage}
                        alt={book.title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className={`flex h-full w-full items-center justify-center bg-gradient-to-br ${GRADIENT_COVERS[i % GRADIENT_COVERS.length]}`}>
                        <span className="text-3xl font-bold tracking-wider text-white/30 select-none">
                          {book.title.slice(0, 2).toUpperCase()}
                        </span>
                      </div>
                    )}
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-3 pt-8">
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
                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-emerald-500 transition-all"
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
                  className="absolute right-2 top-2 flex cursor-pointer items-center justify-center rounded-lg bg-black/40 p-1.5 text-white/60 opacity-0 transition-all hover:bg-red-500/60 hover:text-white group-hover:opacity-100"
                  title="删除书籍"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
