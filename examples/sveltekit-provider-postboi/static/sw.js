// The service worker Web Push delivers to. `subscribe()` from postboi/push registers
// this file (it looks for /sw.js by default). Receive-only on purpose: no fetch
// handler, no caching — a worker that intercepts requests is a different feature.
//
// The payload is what postboi's Web Push provider sends: { title, body, icon, url }.

self.addEventListener("push", (event) => {
	const note = event.data?.json() ?? {}
	event.waitUntil(
		self.registration.showNotification(note.title ?? "Notification", {
			body: note.body ?? "",
			icon: note.icon,
			data: { url: note.url },
		})
	)
})

self.addEventListener("notificationclick", (event) => {
	event.notification.close()
	if (event.notification.data?.url) {
		event.waitUntil(clients.openWindow(event.notification.data.url))
	}
})
