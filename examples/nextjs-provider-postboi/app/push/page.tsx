import { PushClient } from "./client"

// No key plumbing: `bunx postboi init --push` (or sync) bakes the VAPID public key
// into the package, so the client component needs nothing from the server.
export default function PushPage() {
	return <PushClient />
}
