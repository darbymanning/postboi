import { sms } from "postboi"

// One text. The number must be E.164 (+country code) — anything ambiguous throws rather
// than texting a stranger, and the segment count is worked out before your provider bills it.
//
// In development texts are LOGGED, not sent (a stray text costs money and can't be
// recalled). Set POSTBOI_SMS_DEV=send when you want real delivery, and pick a provider
// with `bunx postboi init --sms`.
const result = await sms({
	to: "+447700900123",
	message: "Your Acme code is 428 916. It expires in 10 minutes.",
})

console.log("sent", result)
