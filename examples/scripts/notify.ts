import { send } from "postboi"

// send() — one call, every channel. Two modes, and this script shows both.
//
// FAN-OUT (default): every channel in `to` is attempted, one result each. A dead SMS
// provider never loses the email. The channels used are exactly the keys you give —
// nothing is inferred.
const fanned = await send({
	to: {
		email: "ada@example.com",
		sms: "+447700900123",
	},
	subject: "Your order shipped",
	message: "Order AC-1042 is on its way — tracking inside.",
})

for (const result of fanned.results) {
	console.log(result.channel, result.ok ? "delivered" : result.error.message)
}

// FALLBACK CHAIN: try in order, stop at the first success — for a message that only
// needs to arrive once. "cheapest" is the built-in cost order
// (push → chat → email → whatsapp → sms): an SMS to Western Europe can cost ~100× a
// push carrying the same words, so the free channels go first. Only channels you've
// given an address for are tried.
const chained = await send({
	to: {
		email: "ada@example.com",
		sms: "+447700900123",
	},
	message: "Nightly backup failed — disk full on db-2.",
	channels: "cheapest",
})

console.log("delivered via", chained.delivered ?? "nothing — every channel failed")
