import { describe, expect, it } from "vitest";
import { tokenize } from "./rsvp-engine.js";
import { chunkDocumentText, DOCUMENT_CHUNK_WORDS } from "./storage-service.js";

describe("document chunking", () => {
	it("splits large text into fixed, independently addressable chunks", () => {
		const text = Array.from(
			{ length: DOCUMENT_CHUNK_WORDS * 2 + 501 },
			(_, index) => `word${index}`,
		).join(" ");

		const chunks = chunkDocumentText("document-id", text);

		expect(chunks).toHaveLength(3);
		expect(chunks.map((chunk) => chunk.wordCount)).toEqual([
			DOCUMENT_CHUNK_WORDS,
			DOCUMENT_CHUNK_WORDS,
			501,
		]);
		expect(chunks.map((chunk) => chunk.startWordIndex)).toEqual([
			0,
			DOCUMENT_CHUNK_WORDS,
			DOCUMENT_CHUNK_WORDS * 2,
		]);
		expect(tokenize(chunks[1].text)[0].text).toBe(
			`word${DOCUMENT_CHUNK_WORDS}`,
		);
	});

	it("returns no chunks for blank text", () => {
		expect(chunkDocumentText("document-id", " \n\n ")).toEqual([]);
	});
});
