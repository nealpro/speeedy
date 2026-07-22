import { type IDBPDatabase, openDB } from "idb";
import type {
	DocumentChunk,
	ReaderSettings,
	SavedDocument,
	UserProfile,
} from "../models/types.js";
import { DEFAULT_SETTINGS, getDefaultFontSize } from "./defaults.js";
import { tokenize, type WordToken } from "./rsvp-engine.js";

const DB_NAME = "speeedy-db";
const DB_VERSION = 3;
const PROFILE_STORE = "profile";
const PROFILE_KEY = "user-profile";
const DOCS_STORE = "documents";
const DOC_CHUNKS_STORE = "document-chunks";

const DOCUMENT_STORAGE_VERSION = 2;
export const DOCUMENT_CHUNK_WORDS = 2_000;

const MAX_SAVED_DOCS = 20;

let dbInstance: IDBPDatabase | null = null;

async function getDb(): Promise<IDBPDatabase> {
	if (dbInstance) return dbInstance;
	dbInstance = await openDB(DB_NAME, DB_VERSION, {
		upgrade(db, oldVersion) {
			try {
				if (!db.objectStoreNames.contains(PROFILE_STORE)) {
					db.createObjectStore(PROFILE_STORE);
				}
				if (oldVersion < 2 && !db.objectStoreNames.contains(DOCS_STORE)) {
					db.createObjectStore(DOCS_STORE, { keyPath: "id" });
				}
				if (oldVersion < 3 && !db.objectStoreNames.contains(DOC_CHUNKS_STORE)) {
					const chunks = db.createObjectStore(DOC_CHUNKS_STORE, {
						keyPath: ["documentId", "chunkIndex"],
					});
					chunks.createIndex("by-document", "documentId");
				}
			} catch (err) {
				console.error("[speeedy] IndexedDB upgrade failed:", err);
			}
		},
		blocked() {
			// Another tab holds an older DB version — the upgrade can't proceed until it closes.
			console.warn("[speeedy] Database upgrade blocked by another tab.");
		},
		blocking() {
			// This tab holds an old version and a newer tab needs to upgrade.
			// Close our connection so the other tab can proceed.
			dbInstance?.close();
			dbInstance = null;
		},
	});
	return dbInstance;
}

function createDefaultProfile(): UserProfile {
	return {
		id: crypto.randomUUID(),
		displayName: "Reader",
		avatarEmoji: "📚",
		avatarImage: null,
		createdAt: new Date().toISOString(),
		goals: { type: "words", target: 10000 },
		totalWordsRead: 0,
		totalTimeMs: 0,
		currentStreak: 0,
		bestStreak: 0,
		lastReadDate: null,
		sessions: [],
		settings: { ...DEFAULT_SETTINGS, fontSize: getDefaultFontSize() },
		baselineWpm: null,
		baselineComprehension: null,
		onboardingSeen: false,
	};
}

export async function loadProfile(): Promise<UserProfile> {
	const db = await getDb();
	const profile = await db.get(PROFILE_STORE, PROFILE_KEY);
	if (profile) return profile as UserProfile;
	const newProfile = createDefaultProfile();
	await db.put(PROFILE_STORE, newProfile, PROFILE_KEY);
	return newProfile;
}

export async function saveProfile(profile: UserProfile): Promise<void> {
	const db = await getDb();
	await db.put(PROFILE_STORE, profile, PROFILE_KEY);
}

export async function exportProfile(): Promise<string> {
	const profile = await loadProfile();
	const json = JSON.stringify(profile);
	const bytes = new TextEncoder().encode(json);
	const compressed = await compressData(bytes);
	const arr = new Uint8Array(compressed);
	let binary = "";
	for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
	return btoa(binary);
}

export async function importProfile(encoded: string): Promise<UserProfile> {
	const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
	const decompressed = await decompressData(bytes);
	const json = new TextDecoder().decode(decompressed);
	const raw = JSON.parse(json);
	if (!isValidProfile(raw)) throw new Error("Invalid profile data.");
	const defaults = createDefaultProfile();
	const merged: UserProfile = {
		...defaults,
		...raw,
		settings: { ...DEFAULT_SETTINGS, ...raw.settings },
	};
	await saveProfile(merged);
	return merged;
}

function isValidProfile(obj: unknown): obj is UserProfile {
	if (!obj || typeof obj !== "object") return false;
	const p = obj as Record<string, unknown>;
	return (
		typeof p.id === "string" &&
		typeof p.displayName === "string" &&
		Array.isArray(p.sessions) &&
		typeof p.settings === "object" &&
		p.settings !== null
	);
}

async function compressData(data: Uint8Array): Promise<ArrayBuffer> {
	const stream = new CompressionStream("gzip");
	const writer = stream.writable.getWriter();
	await writer.write(data.buffer.slice(0) as ArrayBuffer);
	await writer.close();
	return new Response(stream.readable).arrayBuffer();
}

async function decompressData(data: Uint8Array): Promise<ArrayBuffer> {
	const stream = new DecompressionStream("gzip");
	const writer = stream.writable.getWriter();
	await writer.write(data.buffer.slice(0) as ArrayBuffer);
	await writer.close();
	return new Response(stream.readable).arrayBuffer();
}

export async function getSavedDocuments(): Promise<SavedDocument[]> {
	const db = await getDb();
	const docs = (await db.getAll(DOCS_STORE)) as SavedDocument[];
	return docs.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function getSavedDocument(
	id: string,
): Promise<SavedDocument | undefined> {
	const db = await getDb();
	const doc = (await db.get(DOCS_STORE, id)) as SavedDocument | undefined;
	if (!doc) return undefined;
	return ensureDocumentChunked(doc);
}

async function hashContent(text: string): Promise<string> {
	const buf = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(text),
	);
	return Array.from(new Uint8Array(buf))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

export async function saveDocument(
	doc: Omit<SavedDocument, "id" | "savedAt">,
): Promise<SavedDocument> {
	const db = await getDb();
	const text = doc.text ?? "";
	const contentHash = await hashContent(text);
	const all = (await db.getAll(DOCS_STORE)) as SavedDocument[];

	for (const existing of all) {
		const existingHash =
			existing.contentHash ??
			(existing.text != null ? await hashContent(existing.text) : undefined);
		if (existingHash === contentHash) {
			const updated: SavedDocument = {
				...existing,
				savedAt: new Date().toISOString(),
			};
			await db.put(DOCS_STORE, updated);
			return updated;
		}
	}

	const id = crypto.randomUUID();
	const chunks = chunkDocumentText(id, text);
	const wordCount = chunks.reduce((total, chunk) => total + chunk.wordCount, 0);
	const saved: SavedDocument = {
		...doc,
		text: undefined,
		wordCount,
		id,
		savedAt: new Date().toISOString(),
		contentHash,
		storageVersion: DOCUMENT_STORAGE_VERSION,
		chunkCount: chunks.length,
	};
	const tx = db.transaction([DOCS_STORE, DOC_CHUNKS_STORE], "readwrite");
	await tx.objectStore(DOCS_STORE).put(saved);
	for (const chunk of chunks) {
		await tx.objectStore(DOC_CHUNKS_STORE).put(chunk);
	}
	await tx.done;
	await pruneDocuments(db);
	return saved;
}

export function chunkDocumentText(
	documentId: string,
	text: string,
): DocumentChunk[] {
	const normalized = text
		.replace(/\r\n?/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	if (!normalized) return [];

	const tokens = tokenize(normalized);
	const chunks: DocumentChunk[] = [];
	for (
		let startWordIndex = 0;
		startWordIndex < tokens.length;
		startWordIndex += DOCUMENT_CHUNK_WORDS
	) {
		const chunkTokens = tokens.slice(
			startWordIndex,
			startWordIndex + DOCUMENT_CHUNK_WORDS,
		);
		chunks.push({
			documentId,
			chunkIndex: chunks.length,
			startWordIndex,
			wordCount: chunkTokens.length,
			text: chunkTokens.map((token) => token.text).join(" "),
		});
	}
	return chunks;
}

async function ensureDocumentChunked(
	doc: SavedDocument,
): Promise<SavedDocument> {
	if (doc.storageVersion === DOCUMENT_STORAGE_VERSION) return doc;
	if (doc.text == null) return doc;

	const db = await getDb();
	const chunks = chunkDocumentText(doc.id, doc.text);
	const wordCount = chunks.reduce((total, chunk) => total + chunk.wordCount, 0);
	const migrated: SavedDocument = {
		...doc,
		text: undefined,
		wordCount,
		storageVersion: DOCUMENT_STORAGE_VERSION,
		chunkCount: chunks.length,
	};
	const tx = db.transaction([DOCS_STORE, DOC_CHUNKS_STORE], "readwrite");
	for (const chunk of chunks) await tx.objectStore(DOC_CHUNKS_STORE).put(chunk);
	await tx.objectStore(DOCS_STORE).put(migrated);
	await tx.done;
	return migrated;
}

export async function getDocumentText(id: string): Promise<string> {
	const doc = await getSavedDocument(id);
	if (!doc) return "";
	if (doc.text != null) return doc.text;
	const db = await getDb();
	const chunks = (await db.getAllFromIndex(
		DOC_CHUNKS_STORE,
		"by-document",
		id,
	)) as DocumentChunk[];
	return chunks
		.sort((a, b) => a.chunkIndex - b.chunkIndex)
		.map((chunk) => chunk.text)
		.join("\n\n");
}

export async function getDocumentTokenWindow(
	id: string,
	start: number,
	count: number,
	settings?: ReaderSettings,
): Promise<WordToken[]> {
	const doc = await getSavedDocument(id);
	if (!doc || count <= 0) return [];
	const windowStart = Math.max(
		0,
		Math.min(start, Math.max(0, doc.wordCount - 1)),
	);
	const windowEnd = Math.min(doc.wordCount, windowStart + count);
	const db = await getDb();
	const result: WordToken[] = [];
	const firstChunk = Math.floor(windowStart / DOCUMENT_CHUNK_WORDS);
	const lastChunk = Math.floor(
		Math.max(windowStart, windowEnd - 1) / DOCUMENT_CHUNK_WORDS,
	);
	for (let chunkIndex = firstChunk; chunkIndex <= lastChunk; chunkIndex++) {
		const chunk = (await db.get(DOC_CHUNKS_STORE, [id, chunkIndex])) as
			| DocumentChunk
			| undefined;
		if (!chunk) continue;
		const chunkEnd = chunk.startWordIndex + chunk.wordCount;
		if (chunkEnd <= windowStart || chunk.startWordIndex >= windowEnd) continue;
		const tokens = tokenize(chunk.text, settings);
		const from = Math.max(0, windowStart - chunk.startWordIndex);
		const to = Math.min(tokens.length, windowEnd - chunk.startWordIndex);
		result.push(...tokens.slice(from, to));
	}
	return result;
}

export async function saveLargePlainTextFile(
	file: File,
	title = file.name.replace(/\.[^.]+$/, ""),
): Promise<SavedDocument> {
	const db = await getDb();
	const id = crypto.randomUUID();
	const reader = file.stream().pipeThrough(new TextDecoderStream()).getReader();
	let carry = "";
	const pendingWords: string[] = [];
	let wordCount = 0;
	let chunkIndex = 0;
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			const combined = carry + value.replace(/\r\n?/g, "\n");
			const pieces = combined.split(/\s+/);
			carry = pieces.pop() ?? "";
			const completeText = pieces.filter(Boolean).join(" ");
			if (completeText) {
				pendingWords.push(...tokenize(completeText).map((token) => token.text));
			}
			while (pendingWords.length >= DOCUMENT_CHUNK_WORDS) {
				const words = pendingWords.splice(0, DOCUMENT_CHUNK_WORDS);
				const chunk: DocumentChunk = {
					documentId: id,
					chunkIndex: chunkIndex++,
					startWordIndex: wordCount,
					wordCount: words.length,
					text: words.join(" "),
				};
				wordCount += words.length;
				await db.put(DOC_CHUNKS_STORE, chunk);
			}
		}
		if (carry.trim()) {
			pendingWords.push(...tokenize(carry.trim()).map((token) => token.text));
		}
		if (pendingWords.length > 0) {
			await db.put(DOC_CHUNKS_STORE, {
				documentId: id,
				chunkIndex: chunkIndex++,
				startWordIndex: wordCount,
				wordCount: pendingWords.length,
				text: pendingWords.join(" "),
			} satisfies DocumentChunk);
			wordCount += pendingWords.length;
		}
		const saved: SavedDocument = {
			id,
			title,
			wordCount,
			savedAt: new Date().toISOString(),
			resumeWordIndex: 0,
			completionPercent: 0,
			storageVersion: DOCUMENT_STORAGE_VERSION,
			chunkCount: chunkIndex,
		};
		await db.put(DOCS_STORE, saved);
		await pruneDocuments(db);
		return saved;
	} catch (error) {
		await deleteDocumentChunks(db, id);
		throw error;
	}
}

export async function updateDocumentProgress(
	id: string,
	resumeWordIndex: number,
	completionPercent: number,
): Promise<void> {
	const db = await getDb();
	const doc = (await db.get(DOCS_STORE, id)) as SavedDocument | undefined;
	if (!doc) return;
	await db.put(DOCS_STORE, { ...doc, resumeWordIndex, completionPercent });
}

export async function updateDocumentTitle(
	id: string,
	title: string,
): Promise<void> {
	const db = await getDb();
	const doc = (await db.get(DOCS_STORE, id)) as SavedDocument | undefined;
	if (!doc) return;
	await db.put(DOCS_STORE, { ...doc, title: title.trim() || doc.title });
}

export async function deleteSavedDocument(id: string): Promise<void> {
	const db = await getDb();
	const tx = db.transaction([DOCS_STORE, DOC_CHUNKS_STORE], "readwrite");
	await tx.objectStore(DOCS_STORE).delete(id);
	const keys = await tx
		.objectStore(DOC_CHUNKS_STORE)
		.index("by-document")
		.getAllKeys(id);
	for (const key of keys) await tx.objectStore(DOC_CHUNKS_STORE).delete(key);
	await tx.done;
}

async function deleteDocumentChunks(
	db: IDBPDatabase,
	id: string,
): Promise<void> {
	const tx = db.transaction(DOC_CHUNKS_STORE, "readwrite");
	const keys = await tx.store.index("by-document").getAllKeys(id);
	for (const key of keys) await tx.store.delete(key);
	await tx.done;
}

async function pruneDocuments(db: IDBPDatabase): Promise<void> {
	const all = ((await db.getAll(DOCS_STORE)) as SavedDocument[]).sort((a, b) =>
		b.savedAt.localeCompare(a.savedAt),
	);
	if (all.length > MAX_SAVED_DOCS) {
		const toDelete = all.slice(MAX_SAVED_DOCS);
		for (const doc of toDelete) {
			await deleteSavedDocument(doc.id);
		}
	}
}
