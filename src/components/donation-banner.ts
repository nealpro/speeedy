import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { Heart, X } from "lucide";
import type { UserProfile } from "../models/types.js";
import { formatDuration, getTimeSavedMs } from "../services/stats-service.js";
import { saveProfile } from "../services/storage-service.js";
import { emitProfileUpdated } from "../utils/events.js";
import { icon } from "../utils/icons.js";

const SESSIONS_BEFORE_SHOW = 2;
const REAPPEAR_AFTER_DAYS = 14;
const REAPPEAR_AFTER_SESSIONS = 8;
const MIN_TIME_SAVED_MS_TO_MENTION = 10 * 60_000;

@customElement("donation-banner")
export class DonationBanner extends LitElement {
	protected override createRenderRoot() {
		return this;
	}

	@property({ type: Object }) profile!: UserProfile;
	@state() private visible = false;

	override connectedCallback(): void {
		super.connectedCallback();
		this.visible = this.shouldShow();
	}

	private shouldShow(): boolean {
		const sessionCount = this.profile?.sessions?.length ?? 0;
		if (sessionCount < SESSIONS_BEFORE_SHOW) return false;

		const dismissedAt = this.profile?.donationNudgeDismissedAt;
		if (!dismissedAt) return true;

		const daysSinceDismiss =
			(Date.now() - new Date(dismissedAt).getTime()) / 86_400_000;
		const sessionsSinceDismiss =
			sessionCount - (this.profile?.donationNudgeDismissedAtSessionCount ?? 0);

		return (
			daysSinceDismiss >= REAPPEAR_AFTER_DAYS ||
			sessionsSinceDismiss >= REAPPEAR_AFTER_SESSIONS
		);
	}

	private get message(): string {
		const savedMs = this.profile ? getTimeSavedMs(this.profile) : 0;
		if (savedMs >= MIN_TIME_SAVED_MS_TO_MENTION) {
			return `You've saved ~${formatDuration(savedMs)} reading with Speeedy. Support the dev →`;
		}
		return "Speeedy is built solo, ad-free. Support the dev →";
	}

	private dismiss = (): void => {
		this.visible = false;
		const updated: UserProfile = {
			...this.profile,
			donationNudgeDismissedAt: new Date().toISOString(),
			donationNudgeDismissedAtSessionCount: this.profile?.sessions?.length ?? 0,
		};
		saveProfile(updated);
		emitProfileUpdated(updated);
	};

	override render() {
		if (!this.visible) return html``;

		return html`
      <div class="border-b border-base-200/80 bg-base-200/30 px-6 py-2.5">
        <div class="max-w-2xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-3">

          <div class="flex items-center gap-2.5 min-w-0">
            ${icon(Heart, "w-3 h-3 text-error shrink-0")}
            <p class="text-[0.7rem] uppercase tracking-wider text-base-content/50 font-medium">
              ${this.message}
            </p>
          </div>

          <div class="flex items-center gap-2 shrink-0">
            <a
              href="#/donate"
              class="btn btn-xs btn-outline border-error/30 text-error hover:bg-error hover:text-error-content hover:border-error gap-1.5 px-3"
              data-umami-event="donation-banner-click"
            >
              ${icon(Heart, "w-2.5 h-2.5")}
              Support
            </a>
            <button
              class="btn btn-xs btn-ghost text-base-content/30 hover:text-base-content/60 btn-circle"
              aria-label="Dismiss"
              data-umami-event="donation-banner-dismiss"
              @click=${this.dismiss}
            >
              ${icon(X, "w-3 h-3")}
            </button>
          </div>

        </div>
      </div>
    `;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"donation-banner": DonationBanner;
	}
}
