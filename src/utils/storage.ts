import localforage from "localforage";

export interface TocItem {
  title: string;
  page: number;
  level: number;
}

export interface BookMeta {
  id: string;
  title: string;
  author: string;
  size: number;
  uploadTime: number;
  content: string;
  fileType: "pdf" | "epub" | "txt";
  tocItems: TocItem[];
  pageMarkers: number[];
  readProgress: number;
  currentPage: number;
  coverImage?: string;
  epubCfi?: string;
}

export interface Note {
  id: string;
  pageNumber: number;
  quote: string;
  content: string;
  createdAt: number;
  chapter?: string;
}

const booksStore = localforage.createInstance({
  name: "ai_reader",
  storeName: "books",
});

const BOOKS_KEY = "book_list";

export async function getBooks(): Promise<BookMeta[]> {
  const data = await booksStore.getItem<BookMeta[]>(BOOKS_KEY);
  return data || [];
}

export async function saveBooks(books: BookMeta[]): Promise<void> {
  await booksStore.setItem(BOOKS_KEY, books);
}

export async function getBookById(id: string): Promise<BookMeta | null> {
  const books = await getBooks();
  return books.find((b) => b.id === id) || null;
}

export async function deleteBook(id: string): Promise<BookMeta[]> {
  const books = await getBooks();
  const updated = books.filter((b) => b.id !== id);
  await saveBooks(updated);
  await deleteFileData(id);
  return updated;
}

export async function addBook(book: BookMeta): Promise<void> {
  const books = await getBooks();
  books.push(book);
  await saveBooks(books);
}

const filesStore = localforage.createInstance({
  name: "ai_reader",
  storeName: "files",
});

export async function saveFileData(id: string, data: Blob): Promise<void> {
  await filesStore.setItem(id, data);
}

export async function getFileData(id: string): Promise<Blob | null> {
  const data = await filesStore.getItem<Blob>(id);
  return data || null;
}

export async function deleteFileData(id: string): Promise<void> {
  await filesStore.removeItem(id);
}

export async function updateBookProgress(id: string, currentPage: number, totalPages: number): Promise<void> {
  const books = await getBooks();
  const book = books.find((b) => b.id === id);
  if (!book) return;
  book.currentPage = currentPage;
  book.readProgress = Math.round((currentPage / totalPages) * 100);
  await saveBooks(books);
}

export async function updateEpubProgress(id: string, cfi: string): Promise<void> {
  const books = await getBooks();
  const book = books.find((b) => b.id === id);
  if (!book) return;
  book.epubCfi = cfi;
  await saveBooks(books);
}

const notesStore = localforage.createInstance({
  name: "ai_reader",
  storeName: "notes",
});

export async function getNotes(bookId: string): Promise<Note[]> {
  const notes = await notesStore.getItem<Note[]>(bookId);
  return notes || [];
}

export async function saveNote(bookId: string, note: Note): Promise<Note[]> {
  const notes = await getNotes(bookId);
  notes.push(note);
  await notesStore.setItem(bookId, notes);
  return notes;
}

export async function deleteNote(bookId: string, noteId: string): Promise<Note[]> {
  const notes = await getNotes(bookId);
  const updated = notes.filter((n) => n.id !== noteId);
  await notesStore.setItem(bookId, updated);
  return updated;
}

export async function updateNote(bookId: string, updatedNote: Note): Promise<Note[]> {
  const notes = await getNotes(bookId);
  const idx = notes.findIndex((n) => n.id === updatedNote.id);
  if (idx === -1) return notes;
  notes[idx] = updatedNote;
  await notesStore.setItem(bookId, notes);
  return notes;
}