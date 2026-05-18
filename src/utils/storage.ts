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
  storage?: "indexeddb" | "appData";
  originalFileName?: string;
  filePath?: string;
  fileHash?: string;
  coverImage?: string;
  epubCfi?: string;
}

interface DesktopFilePayload {
  name?: string;
  size: number;
  lastModified?: number;
  dataBase64: string;
}

export interface ReaderPreferences {
  theme?: string;
  fontSize?: number;
  fontFamily?: string;
  epubWordSpacing?: number;
  apiConfig?: unknown;
  identityId?: string;
  userPrompt?: string;
}

export interface BookNotes {
  bookId: string;
  notes: Note[];
}

export interface DesktopLibraryState {
  version: 1;
  updatedAt: number;
  books: BookMeta[];
  notes: BookNotes[];
  preferences?: ReaderPreferences;
}

interface DesktopBridge {
  isDesktop: boolean;
  selectBookFiles?: () => Promise<Array<DesktopFilePayload & { path?: string; name: string }>>;
  persistBookFile?: (payload: {
    bookId: string;
    name: string;
    sourcePath?: string;
    dataBase64?: string;
    fileHash?: string;
  }) => Promise<{
    storage: "appData";
    originalFileName: string;
    filePath: string;
    size: number;
  }>;
  readBookFile?: (payload: { bookId: string; filePath?: string }) => Promise<DesktopFilePayload>;
  deleteBookFile?: (payload: { bookId: string }) => Promise<boolean>;
  loadLibraryState?: () => Promise<DesktopLibraryState | null>;
  saveLibraryState?: (state: DesktopLibraryState) => Promise<{ ok: true; path: string }>;
  getLibraryStatePath?: () => Promise<string>;
}

declare global {
  interface Window {
    aiReaderDesktop?: DesktopBridge;
  }
}

function getDesktopBridge(): DesktopBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return window.aiReaderDesktop;
}

export interface Note {
  id: string;
  pageNumber: number;
  quote: string;
  content: string;
  createdAt: number;
  chapter?: string;
  anchor?: {
    format: BookMeta["fileType"];
    pageNumber: number;
    epubCfi?: string;
    textOffset?: number;
  };
}

const booksStore = localforage.createInstance({
  name: "ai_reader",
  storeName: "books",
});

const BOOKS_KEY = "book_list";
const READER_PREFS_KEY = "reader_preferences";

let desktopStateCache: DesktopLibraryState | null | undefined;

function isDesktopStorageAvailable(): boolean {
  const desktop = getDesktopBridge();
  return Boolean(desktop?.isDesktop && desktop.loadLibraryState && desktop.saveLibraryState);
}

function emptyDesktopState(): DesktopLibraryState {
  return {
    version: 1,
    updatedAt: Date.now(),
    books: [],
    notes: [],
    preferences: {},
  };
}

function normalizeDesktopState(state: DesktopLibraryState | null | undefined): DesktopLibraryState {
  return {
    version: 1,
    updatedAt: state?.updatedAt || Date.now(),
    books: Array.isArray(state?.books) ? state.books : [],
    notes: Array.isArray(state?.notes) ? state.notes : [],
    preferences: state?.preferences || {},
  };
}

async function rawGetBooks(): Promise<BookMeta[]> {
  const data = await booksStore.getItem<BookMeta[]>(BOOKS_KEY);
  return data || [];
}

async function rawSaveBooks(books: BookMeta[]): Promise<void> {
  await booksStore.setItem(BOOKS_KEY, books);
}

async function rawGetNotes(bookId: string): Promise<Note[]> {
  const notes = await notesStore.getItem<Note[]>(bookId);
  return notes || [];
}

async function rawSetNotes(bookId: string, notes: Note[]): Promise<void> {
  await notesStore.setItem(bookId, notes);
}

async function rawGetAllNotes(): Promise<BookNotes[]> {
  const result: BookNotes[] = [];
  await notesStore.iterate<Note[], void>((notes, bookId) => {
    if (Array.isArray(notes)) result.push({ bookId, notes });
  });
  return result;
}

async function rawLoadReaderPreferences(): Promise<ReaderPreferences> {
  const saved = await localforage.getItem<ReaderPreferences>(READER_PREFS_KEY);
  const identity = typeof window !== "undefined"
    ? window.localStorage.getItem("reader_ai_identity")
    : null;
  if (!identity) return saved || {};
  try {
    return { ...(saved || {}), ...JSON.parse(identity) };
  } catch {
    return saved || {};
  }
}

async function rawSaveReaderPreferences(preferences: ReaderPreferences): Promise<void> {
  await localforage.setItem(READER_PREFS_KEY, preferences);
  if (typeof window !== "undefined") {
    window.localStorage.setItem("reader_ai_identity", JSON.stringify({
      identityId: preferences.identityId,
      userPrompt: preferences.userPrompt,
    }));
  }
}

export async function loadLibraryState(): Promise<DesktopLibraryState | null> {
  if (!isDesktopStorageAvailable()) return null;
  if (desktopStateCache !== undefined) return desktopStateCache;

  const desktop = getDesktopBridge();
  const loaded = await desktop?.loadLibraryState?.();
  if (loaded) {
    desktopStateCache = normalizeDesktopState(loaded);
    return desktopStateCache;
  }

  const books = await rawGetBooks();
  const notes = await rawGetAllNotes();
  const preferences = await rawLoadReaderPreferences();
  if (books.length > 0 || notes.length > 0 || Object.keys(preferences).length > 0) {
    desktopStateCache = normalizeDesktopState({
      version: 1,
      updatedAt: Date.now(),
      books,
      notes,
      preferences,
    });
    await persistLibraryState(desktopStateCache);
    return desktopStateCache;
  }

  desktopStateCache = emptyDesktopState();
  return desktopStateCache;
}

export async function persistLibraryState(state: DesktopLibraryState): Promise<void> {
  if (!isDesktopStorageAvailable()) return;
  const normalized = normalizeDesktopState({ ...state, updatedAt: Date.now() });
  await getDesktopBridge()?.saveLibraryState?.(normalized);
  desktopStateCache = normalized;
}

async function updateDesktopState(
  updater: (state: DesktopLibraryState) => DesktopLibraryState | void,
): Promise<DesktopLibraryState | null> {
  const state = await loadLibraryState();
  if (!state) return null;
  const draft = { ...state, books: [...state.books], notes: [...state.notes] };
  const next = updater(draft) || draft;
  await persistLibraryState(next);
  return next;
}

export async function migrateIndexedDbToDesktopStateIfNeeded(): Promise<void> {
  await loadLibraryState();
}

export async function loadReaderPreferences(): Promise<ReaderPreferences> {
  const desktopState = await loadLibraryState();
  if (desktopState) return desktopState.preferences || {};
  return rawLoadReaderPreferences();
}

export async function saveReaderPreferences(preferences: ReaderPreferences): Promise<void> {
  await rawSaveReaderPreferences(preferences);
  await updateDesktopState((state) => {
    state.preferences = preferences;
  });
}

export async function getBooks(): Promise<BookMeta[]> {
  const desktopState = await loadLibraryState();
  if (desktopState) return desktopState.books;
  return rawGetBooks();
}

export async function saveBooks(books: BookMeta[]): Promise<void> {
  await rawSaveBooks(books);
  await updateDesktopState((state) => {
    state.books = books;
  });
}

export async function getBookById(id: string): Promise<BookMeta | null> {
  const books = await getBooks();
  return books.find((b) => b.id === id) || null;
}

export async function deleteBook(id: string): Promise<BookMeta[]> {
  const books = await getBooks();
  const book = books.find((b) => b.id === id);
  const updated = books.filter((b) => b.id !== id);
  await saveBooks(updated);
  if (book?.storage === "appData") {
    try {
      await getDesktopBridge()?.deleteBookFile?.({ bookId: id });
    } catch (err) {
      console.error("删除 App 数据目录文件失败:", err);
    }
  }
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
  const desktopState = await loadLibraryState();
  if (desktopState) return desktopState.notes.find((item) => item.bookId === bookId)?.notes || [];
  return rawGetNotes(bookId);
}

export async function saveNote(bookId: string, note: Note): Promise<Note[]> {
  const notes = await getNotes(bookId);
  notes.push(note);
  await rawSetNotes(bookId, notes);
  await updateDesktopState((state) => {
    const idx = state.notes.findIndex((item) => item.bookId === bookId);
    if (idx === -1) state.notes.push({ bookId, notes });
    else state.notes[idx] = { bookId, notes };
  });
  return notes;
}

export async function deleteNote(bookId: string, noteId: string): Promise<Note[]> {
  const notes = await getNotes(bookId);
  const updated = notes.filter((n) => n.id !== noteId);
  await rawSetNotes(bookId, updated);
  await updateDesktopState((state) => {
    const idx = state.notes.findIndex((item) => item.bookId === bookId);
    if (idx === -1) state.notes.push({ bookId, notes: updated });
    else state.notes[idx] = { bookId, notes: updated };
  });
  return updated;
}

export async function updateNote(bookId: string, updatedNote: Note): Promise<Note[]> {
  const notes = await getNotes(bookId);
  const idx = notes.findIndex((n) => n.id === updatedNote.id);
  if (idx === -1) return notes;
  notes[idx] = updatedNote;
  await rawSetNotes(bookId, notes);
  await updateDesktopState((state) => {
    const noteIdx = state.notes.findIndex((item) => item.bookId === bookId);
    if (noteIdx === -1) state.notes.push({ bookId, notes });
    else state.notes[noteIdx] = { bookId, notes };
  });
  return notes;
}

export interface LibraryBackup {
  version: 1;
  exportedAt: number;
  books: BookMeta[];
  notes: BookNotes[];
  files: Array<{
    bookId: string;
    type: string;
    dataUrl: string;
  }>;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

function dataUrlToBase64(dataUrl: string): string {
  return dataUrl.split(",", 2)[1] || "";
}

function desktopPayloadToBlob(payload: DesktopFilePayload): Blob {
  const binary = atob(payload.dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes]);
}

export async function getBookFileBlob(book: BookMeta): Promise<Blob | null> {
  if (book.storage === "appData") {
    try {
      const payload = await getDesktopBridge()?.readBookFile?.({
        bookId: book.id,
        filePath: book.filePath,
      });
      if (payload) return desktopPayloadToBlob(payload);
    } catch (err) {
      console.warn("读取 App 数据目录文件失败，回退 IndexedDB:", err);
    }
  }
  return getFileData(book.id);
}

export async function getAllNotes(): Promise<BookNotes[]> {
  const desktopState = await loadLibraryState();
  if (desktopState) return desktopState.notes;
  return rawGetAllNotes();
}

export async function exportLibraryData(): Promise<LibraryBackup> {
  const books = await getBooks();
  const notes = await getAllNotes();
  const files: LibraryBackup["files"] = [];

  for (const book of books) {
    const file = await getBookFileBlob(book);
    if (!file) continue;
    files.push({
      bookId: book.id,
      type: file.type || "application/octet-stream",
      dataUrl: await blobToDataUrl(file),
    });
  }

  return {
    version: 1,
    exportedAt: Date.now(),
    books,
    notes,
    files,
  };
}

export async function importLibraryData(backup: LibraryBackup): Promise<BookMeta[]> {
  if (!backup || backup.version !== 1 || !Array.isArray(backup.books)) {
    throw new Error("不支持的备份文件格式");
  }

  const books = backup.books.map((book) => ({ ...book }));

  for (const item of backup.files || []) {
    if (!item.bookId || !item.dataUrl) continue;
    const book = books.find((b) => b.id === item.bookId);
    const fileName = book?.originalFileName || `${book?.title || item.bookId}.${book?.fileType || "book"}`;
    const desktop = getDesktopBridge();
    if (desktop?.persistBookFile) {
      try {
        const persisted = await desktop.persistBookFile({
          bookId: item.bookId,
          name: fileName,
          dataBase64: dataUrlToBase64(item.dataUrl),
          fileHash: book?.fileHash,
        });
        if (book) {
          book.storage = "appData";
          book.originalFileName = persisted.originalFileName;
          book.filePath = persisted.filePath;
        }
        continue;
      } catch (err) {
        console.warn("恢复到 App 数据目录失败，回退 IndexedDB:", err);
      }
    }
    await saveFileData(item.bookId, await dataUrlToBlob(item.dataUrl));
    if (book) {
      book.storage = "indexeddb";
      book.originalFileName = book.originalFileName || fileName;
      delete book.filePath;
    }
  }

  const restoredNotes: BookNotes[] = [];
  for (const item of backup.notes || []) {
    if (!item.bookId || !Array.isArray(item.notes)) continue;
    await notesStore.setItem(item.bookId, item.notes);
    restoredNotes.push({ bookId: item.bookId, notes: item.notes });
  }

  await saveBooks(books);
  await updateDesktopState((state) => {
    state.books = books;
    state.notes = restoredNotes;
  });
  return books;
}
