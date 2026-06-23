import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	applyBionicReading,
	createDocFromText,
	parseFile,
} from "./text-parser.js";

describe("applyBionicReading", () => {
	it("wraps the first ~40% of each word in bold tags", () => {
		const result = applyBionicReading("hello");
		// "hello" has 5 chars, 40% = 2 → bold first 2 chars
		expect(result).toBe("<b>he</b>llo");
	});

	it("handles single character word", () => {
		const result = applyBionicReading("a");
		// 1 char, ceil(0.4) = 1 → entire word bolded
		expect(result).toBe("<b>a</b>");
	});

	it("handles two character word", () => {
		const result = applyBionicReading("hi");
		// 2 chars, ceil(0.8) = 1 → bold first 1 char
		expect(result).toBe("<b>h</b>i");
	});

	it("processes multiple words", () => {
		const result = applyBionicReading("hello world");
		expect(result).toContain("<b>");
		expect(result).toContain("</b>");
		// Should have two bold segments
		const boldCount = (result.match(/<b>/g) ?? []).length;
		expect(boldCount).toBe(2);
	});

	it("escapes HTML special characters in word content", () => {
		const result = applyBionicReading("a&b");
		expect(result).toContain("&amp;");
	});

	it("handles words with punctuation", () => {
		const result = applyBionicReading("hello,");
		// "hello," has 6 chars, clean = "hello" (5 chars), boldLen = ceil(5*0.4) = 2
		// bold first 2 chars of "hello,"
		expect(result).toContain("<b>he</b>");
	});

	it("handles empty string", () => {
		const result = applyBionicReading("");
		expect(result).toBe("");
	});

	it("handles punctuation-only word", () => {
		const result = applyBionicReading("...");
		// clean = "" (no letters/numbers), returns escaped word
		expect(result).toBe("...");
	});

	it("escapes angle brackets", () => {
		const result = applyBionicReading("a<b");
		expect(result).toContain("&lt;");
	});

	it("escapes quotes", () => {
		const result = applyBionicReading('say"hi"');
		expect(result).toContain("&quot;");
	});
});

describe("parseFile (EPUB)", () => {
	it("extracts text and title from a valid EPUB", async () => {
		const buffer = readFileSync(
			join(import.meta.dirname, "../../test-fixtures/sample.epub"),
		);
		const file = new File([buffer], "sample.epub", {
			type: "application/epub+zip",
		});

		const doc = await parseFile(file);

		expect(doc.title).toBe("Test Book");
		expect(doc.text).toContain("Hello EPUB world");
		expect(doc.wordCount).toBeGreaterThan(0);
	});
});

describe("createDocFromText", () => {
	it("creates a document with the given text", () => {
		const doc = createDocFromText("Hello world");
		expect(doc.text).toBe("Hello world");
	});

	it("uses default title 'Untitled' when not provided", () => {
		const doc = createDocFromText("Some text");
		expect(doc.title).toBe("Untitled");
	});

	it("uses provided title", () => {
		const doc = createDocFromText("Some text", "My Book");
		expect(doc.title).toBe("My Book");
	});

	it("counts words correctly", () => {
		const doc = createDocFromText("one two three four five");
		expect(doc.wordCount).toBe(5);
	});

	it("cleans up excessive whitespace", () => {
		const doc = createDocFromText("hello   world");
		expect(doc.text).toBe("hello world");
	});

	it("normalizes Windows line endings", () => {
		const doc = createDocFromText("line one\r\nline two");
		expect(doc.text).not.toContain("\r");
		expect(doc.text).toContain("\n");
	});

	it("collapses more than 2 consecutive newlines to 2", () => {
		const doc = createDocFromText("para one\n\n\n\npara two");
		expect(doc.text).toBe("para one\n\npara two");
	});

	it("trims leading and trailing whitespace", () => {
		const doc = createDocFromText("   hello world   ");
		expect(doc.text).toBe("hello world");
	});

	it("returns wordCount of 0 for empty text", () => {
		const doc = createDocFromText("");
		expect(doc.wordCount).toBe(0);
	});

	it("handles text with only whitespace", () => {
		const doc = createDocFromText("   \n\n   ");
		expect(doc.text).toBe("");
		expect(doc.wordCount).toBe(0);
	});
});
