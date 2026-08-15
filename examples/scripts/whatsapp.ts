import { whatsapp } from "postboi"

// WhatsApp is templates-first by design: free-form `message` only delivers within 24
// hours of the person's last reply, and most transactional sends happen outside that
// window. Create the template in your provider's console, then name it here.
//
// In development messages are logged, not sent — POSTBOI_WHATSAPP_DEV=send for real
// delivery, and `bunx postboi init --whatsapp` to pick Twilio or Meta's Cloud API.
const result = await whatsapp({
	to: "+447700900123",
	template: "order_shipped",
	variables: { name: "Ada", order: "AC-1042" },
})

console.log("sent", result)
