import { slack, discord } from "postboi"

// Your app's ops channel: one env var per platform (SLACK_WEBHOOK_URL,
// DISCORD_WEBHOOK_URL) and your backend can talk to the team. Separate imports on
// purpose — posting to several platforms needs no provider choice at all.
await slack({
	title: "Deploy finished",
	message: "v2.4.1 is live — 12s build, all checks green.",
})

await discord({
	message: "New signup: ada@example.com (via the pricing page)",
})

console.log("posted")
