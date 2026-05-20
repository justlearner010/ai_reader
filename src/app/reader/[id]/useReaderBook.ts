"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getBookById,
  getBookFileBlob,
  type BookMeta,
} from "@/utils/storage";

export type ReaderBookFormat = BookMeta["fileType"];

export function useReaderBook(bookId: string) {
  const [bookTitle, setBookTitle] = useState("");
  const [bookFormat, setBookFormat] = useState<ReaderBookFormat>("txt");
  const [tocItems, setTocItems] = useState<BookMeta["tocItems"]>([]);
  const [extractedText, setExtractedText] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [fileMissing, setFileMissing] = useState(false);
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);
  const [pageMarkers, setPageMarkers] = useState<number[]>([]);
  const [initialProgress, setInitialProgress] = useState(0);
  const [initialCfi, setInitialCfi] = useState("");
  const pdfDataRef = useRef<ArrayBuffer | null>(null);

  const loadBinaryData = useCallback((arrayBuffer: ArrayBuffer) => {
    pdfDataRef.current = arrayBuffer;
    setPdfData(arrayBuffer);
  }, []);

  const loadLocalFile = useCallback(async (file: File) => {
    setBookTitle(file.name.replace(/\.(pdf|epub|txt)$/i, ""));
    setIsLoading(true);
    setTocItems([]);
    setFileMissing(false);
    setNotFound(false);

    try {
      const arrayBuffer = await file.arrayBuffer();
      if (file.name.toLowerCase().endsWith(".txt")) {
        setBookFormat("txt");
        setExtractedText(await file.text());
      } else if (file.name.toLowerCase().endsWith(".epub")) {
        setBookFormat("epub");
        loadBinaryData(arrayBuffer);
      } else {
        setBookFormat("pdf");
        loadBinaryData(arrayBuffer);
      }
    } finally {
      setIsLoading(false);
    }
  }, [loadBinaryData]);

  useEffect(() => {
    if (!bookId) {
      setNotFound(true);
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const book = await getBookById(bookId);
        if (cancelled) return;

        if (!book) {
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

        try {
          const fileResult = await getBookFileBlob(book);
          if (cancelled) return;
          if (!fileResult) {
            setFileMissing(true);
            setIsLoading(false);
            return;
          }

          loadBinaryData(await fileResult.arrayBuffer());
        } catch (error) {
          if (!cancelled) {
            console.error("读取书籍文件失败:", error);
            setFileMissing(true);
          }
        } finally {
          if (!cancelled) setIsLoading(false);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("书籍加载失败:", error);
          setNotFound(true);
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bookId, loadBinaryData]);

  return {
    bookTitle,
    bookFormat,
    tocItems,
    extractedText,
    isLoading,
    notFound,
    fileMissing,
    pdfData,
    pageMarkers,
    initialProgress,
    initialCfi,
    pdfDataRef,
    loadBinaryData,
    loadLocalFile,
    setTocItems,
    setPageMarkers,
    setExtractedText,
  };
}
