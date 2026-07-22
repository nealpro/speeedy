import type { ReaderSettings } from "../models/types.js";
import type { DocumentTokenProvider, WordToken } from "./rsvp-engine.js";
import { getDocumentTokenWindow, getSavedDocument } from "./storage-service.js";

export class StoredDocumentProvider implements DocumentTokenProvider {
	readonly documentId: string;
	readonly totalWords: number;

	private constructor(documentId: string, totalWords: number) {
		this.documentId = documentId;
		this.totalWords = totalWords;
	}

	static async open(documentId: string): Promise<StoredDocumentProvider> {
		const document = await getSavedDocument(documentId);
		if (!document) throw new Error("That saved document could not be found.");
		return new StoredDocumentProvider(documentId, document.wordCount);
	}

	getTokens(
		start: number,
		count: number,
		settings: ReaderSettings,
	): Promise<WordToken[]> {
		return getDocumentTokenWindow(this.documentId, start, count, settings);
	}
}
