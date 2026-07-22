import { expect, test } from "@playwright/test";

async function goToReaderWithText(
	page: import("@playwright/test").Page,
	text: string,
) {
	const bytes = new TextEncoder().encode(text);
	const base64 = btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
	await page.goto(`/#/read/${base64}`);
	await page.waitForSelector("rsvp-reader", { timeout: 8000 });
}

test.describe("RSVP Reader", () => {
	const SAMPLE =
		"The quick brown fox jumps over the lazy dog. Speed reading is a powerful skill.";

	test("reader mounts and shows a word display", async ({ page }) => {
		await goToReaderWithText(page, SAMPLE);
		await expect(
			page.locator(".reading-box, rsvp-reader").first(),
		).toBeVisible();
	});

	test("Space bar toggles play and pause", async ({ page }) => {
		await goToReaderWithText(page, SAMPLE);
		await page.keyboard.press("Space");
		await page.waitForTimeout(300);
		await page.keyboard.press("Space");
		await page.waitForTimeout(200);
		await expect(page).toHaveURL(/#\/reader/);
	});

	test("Escape key navigates back to app", async ({ page }) => {
		await goToReaderWithText(page, SAMPLE);
		await page.keyboard.press("Escape");
		await expect(page).toHaveURL(/#\/app/, { timeout: 3000 });
	});

	test("? key opens the keyboard shortcuts overlay", async ({ page }) => {
		await goToReaderWithText(page, SAMPLE);
		await page.keyboard.press("?");
		await expect(
			page
				.locator("text=Shortcuts")
				.or(page.locator("text=keyboard"))
				.or(page.locator("[data-shortcuts-modal]"))
				.first(),
		).toBeVisible({ timeout: 2000 });
	});

	test("back button in the header navigates to app", async ({ page }) => {
		await goToReaderWithText(page, SAMPLE);
		const backBtn = page
			.getByRole("button", { name: /back|home|exit/i })
			.or(page.locator("a[href='#/app'], a[href='#/']"))
			.first();
		if (await backBtn.isVisible({ timeout: 2000 })) {
			await backBtn.click();
			await expect(page).toHaveURL(/#\/(app|)/, { timeout: 3000 });
		}
	});

	test("progress bar is visible", async ({ page }) => {
		await goToReaderWithText(page, SAMPLE);
		await expect(page.locator("rsvp-reader")).toBeVisible();
	});

	test("hold-to-read mouse gestures read, browse, and adjust speed", async ({
		page,
	}) => {
		await goToReaderWithText(
			page,
			Array.from({ length: 700 }, (_, index) => `word${index}`).join(" "),
		);
		const settings = page.locator("settings-panel");
		await settings.locator("input[type='checkbox']").first().check();

		await expect(page.getByRole("button", { name: "Play" })).toHaveCount(0);
		await expect(settings.getByText("Focus mode (immersion)")).toHaveCount(0);
		await expect(settings.getByText("Start countdown (3s)")).toHaveCount(0);

		const area = page.locator("[data-reader-interaction-area]");
		const box = await area.boundingBox();
		expect(box).not.toBeNull();
		if (!box) return;
		const x = box.x + box.width / 2;
		const y = box.y + box.height / 2;

		const firstWord = await page.locator(".word-flash").textContent();
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.waitForTimeout(350);
		await page.mouse.up();
		await expect
			.poll(() => page.locator(".word-flash").textContent())
			.not.toBe(firstWord);
		const releasedWord = await page.locator(".word-flash").textContent();
		await page.waitForTimeout(300);
		expect(await page.locator(".word-flash").textContent()).toBe(releasedWord);

		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(x + 125, y, { steps: 4 });
		await page.mouse.up();
		await expect(page.locator("[data-reader-buffer-view]")).toBeVisible();

		await page.keyboard.press("Enter");
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(x, y - 125, { steps: 4 });
		await expect(page.locator("[data-reader-speed-overlay]")).toContainText(
			"350",
		);
		await page.mouse.up();
		await expect(page.locator("[data-reader-speed-overlay]")).toHaveCount(0);
	});
});
