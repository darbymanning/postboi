// Pull the generated-types placeholder into the compile graph: its `.d.ts` is what
// `bunx postboi sync` overwrites in node_modules to narrow `from` (a no-op at runtime).
import "./register.js"
// Re-export the core so `import { PostboiError, SkipSendError, ... } from "postboi"` keeps working
// from the package root.
export * from "./index.js"
// The zero-config `mail()`/`cancel()` and provider dispatch are general (not Postboi-specific)
// but belong on the package root, so re-export them here.
export { mail, cancel } from "./mail.js"
// The zero-config `sms()` — same shape as `mail()`, on the SMS channel.
export { sms } from "./sms/send.js"
// The zero-config `chat()` — Slack, Discord, Teams, Telegram.
export { chat } from "./chat/send.js"
// The zero-config `push()` — Web Push and FCM.
export { push } from "./push/send.js"
// The multi-channel fan-out. Runs in your process — only transport is ever ours.
export {
	send,
	type FanOutOptions,
	type Recipients,
	type SendResult,
	type ChannelResult,
} from "./send.js"

// The Postboi provider itself lives in its own leaf module — `mail()`'s registry loads it
// with a dynamic import, and a module that is both statically imported (this root, via
// `postboi/kit`) and dynamically imported gets merged into the consumer's entry chunk by
// rollup/rolldown, which then re-exports it from that entry. SvelteKit rejects the extra
// export on route entries ("Invalid export"). Keep the dynamic target a leaf.
export { default } from "./postboi_provider.js"
export type {
	PostboiOptions,
	SendParams,
	MessageDetails,
	ListSummary,
	ListRecipient,
	RecipientStatus,
	ListDetails,
	NewListRecipient,
	ListRecipientInput,
	MembershipStatus,
	Contact,
	Membership,
	ContactDetails,
	ContactInput,
	Suppression,
	BroadcastOptions,
	BroadcastResponse,
	NotificationScheduleInput,
	NotificationSchedule,
	NotificationOptions,
	NotificationDetails,
	ConfirmationSettings,
	ListConfirmationInput,
	ListChanges,
} from "./postboi_provider.js"
