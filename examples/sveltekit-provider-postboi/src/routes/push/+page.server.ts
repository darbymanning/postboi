import { env } from "$env/dynamic/private"

export function load() {
	// The public half of the VAPID pair — the browser subscribes with it, the server
	// signs with the private half, and they must match or every send is rejected.
	// Public by definition, so handing it to the page is fine; absent means push isn't
	// configured yet (`bunx postboi init --push` mints the pair).
	return { vapid_public_key: env.VAPID_PUBLIC_KEY }
}
