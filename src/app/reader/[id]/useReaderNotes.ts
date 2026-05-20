"use client";

import { useCallback, useEffect, useState } from "react";
import {
  deleteNote,
  getNotes,
  saveNote,
  updateNote,
  type BookMeta,
  type Note,
} from "@/utils/storage";

export interface EditingNote {
  id?: string;
  quote: string;
  pageNumber: number;
  content: string;
  isEditing: boolean;
  anchor?: Note["anchor"];
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

function createNoteId(): string {
  return `note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

interface UseReaderNotesOptions {
  bookId: string;
  bookTitle: string;
  bookFormat: BookMeta["fileType"];
  activePage: number;
  currentEpubCfi: string;
  initialCfi: string;
  extractedText: string;
  tocItems: BookMeta["tocItems"];
}

export function useReaderNotes({
  bookId,
  bookTitle,
  bookFormat,
  activePage,
  currentEpubCfi,
  initialCfi,
  extractedText,
  tocItems,
}: UseReaderNotesOptions) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [editingNote, setEditingNote] = useState<EditingNote | null>(null);
  const [returnToPage, setReturnToPage] = useState<number | null>(null);

  useEffect(() => {
    if (!bookId) return;
    let cancelled = false;
    getNotes(bookId).then((loadedNotes) => {
      if (!cancelled) setNotes(loadedNotes);
    });
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  const buildNoteAnchor = useCallback((quote: string): Note["anchor"] => {
    const textOffset = bookFormat === "txt" && quote ? Math.max(0, extractedText.indexOf(quote)) : undefined;
    return {
      format: bookFormat,
      pageNumber: activePage,
      epubCfi: bookFormat === "epub" ? currentEpubCfi || initialCfi || undefined : undefined,
      textOffset,
    };
  }, [activePage, bookFormat, currentEpubCfi, extractedText, initialCfi]);

  const startSelectionNote = useCallback((quote: string) => {
    setEditingNote({
      quote,
      pageNumber: activePage,
      content: "",
      isEditing: false,
      anchor: buildNoteAnchor(quote),
    });
  }, [activePage, buildNoteAnchor]);

  const startManualNote = useCallback(() => {
    setEditingNote({
      quote: bookFormat === "txt" ? "当前位置" : `第 ${activePage} 页`,
      pageNumber: activePage,
      content: "",
      isEditing: false,
      anchor: buildNoteAnchor(""),
    });
  }, [activePage, bookFormat, buildNoteAnchor]);

  const saveEditingNote = useCallback(async () => {
    if (!editingNote || !editingNote.content.trim() || !bookId) return;
    const chapter = getCurrentChapter(editingNote.pageNumber, tocItems);
    const note: Note = {
      id: editingNote.id || createNoteId(),
      pageNumber: editingNote.pageNumber,
      quote: editingNote.quote,
      content: editingNote.content.trim(),
      createdAt: Date.now(),
      chapter,
      anchor: editingNote.anchor || buildNoteAnchor(editingNote.quote),
    };
    const updated = editingNote.isEditing && editingNote.id
      ? await updateNote(bookId, note)
      : await saveNote(bookId, note);
    setNotes(updated);
    setEditingNote(null);
  }, [bookId, buildNoteAnchor, editingNote, tocItems]);

  const editNote = useCallback((note: Note) => {
    setEditingNote({
      id: note.id,
      quote: note.quote,
      pageNumber: note.pageNumber,
      content: note.content,
      isEditing: true,
      anchor: note.anchor,
    });
  }, []);

  const deleteReaderNote = useCallback(async (noteId: string) => {
    if (!bookId) return;
    setNotes(await deleteNote(bookId, noteId));
  }, [bookId]);

  const exportObsidian = useCallback(() => {
    if (!bookTitle || notes.length === 0) return;
    let md = `# 《${bookTitle}》的读书笔记\n`;
    md += `导出时间：${new Date().toLocaleDateString("zh-CN")}\n\n---\n\n`;
    [...notes].reverse().forEach((note) => {
      const ch = note.chapter || "";
      md += `## [${ch}] - 第 ${note.pageNumber} 页\n`;
      md += `> ${note.quote}\n\n`;
      md += `**我的思考**：\n${note.content}\n\n`;
      md += `[在 AI 阅读器中打开](http://localhost:3000/reader/${bookId}?page=${note.pageNumber})\n\n---\n\n`;
    });
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${bookTitle}-读书笔记.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [bookId, bookTitle, notes]);

  const saveAiSelectionNote = useCallback(async (text: string) => {
    if (!bookId) return;
    const localNotes = JSON.parse(localStorage.getItem("my_reader_notes") || "[]") as Array<{
      id: string;
      timestamp: string;
      type: string;
      content: string;
    }>;
    localNotes.push({
      id: Date.now().toString(),
      timestamp: new Date().toLocaleString(),
      type: "ai_selection_snapshot",
      content: text,
    });
    localStorage.setItem("my_reader_notes", JSON.stringify(localNotes));

    const note: Note = {
      id: createNoteId(),
      pageNumber: activePage,
      quote: text,
      content: "",
      createdAt: Date.now(),
      chapter: getCurrentChapter(activePage, tocItems),
      anchor: buildNoteAnchor(text),
    };
    setNotes(await saveNote(bookId, note));
  }, [activePage, bookId, buildNoteAnchor, tocItems]);

  return {
    notes,
    editingNote,
    setEditingNote,
    returnToPage,
    setReturnToPage,
    startSelectionNote,
    startManualNote,
    saveEditingNote,
    editNote,
    deleteReaderNote,
    exportObsidian,
    saveAiSelectionNote,
  };
}
