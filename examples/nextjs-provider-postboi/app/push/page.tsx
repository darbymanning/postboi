import { PushClient } from "./client"

// Server component: reads the VAPID public key from env and hands it to the client
// half. The public key is public by definition — the private half stays on the server
// and signs every send. `bunx postboi init --push` mints the pair.
export default function PushPage() {
	return <PushClient vapidKey={process.env.VAPID_PUBLIC_KEY} />
}
