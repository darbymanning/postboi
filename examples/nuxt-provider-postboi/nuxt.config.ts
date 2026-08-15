export default defineNuxtConfig({
	compatibilityDate: "2025-01-01",
	devtools: { enabled: false },
	runtimeConfig: {
		public: {
			// The public half of the VAPID pair — the browser subscribes with it, the
			// server signs with the private half. `bunx postboi init --push` mints both.
			vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? "",
		},
	},
})
