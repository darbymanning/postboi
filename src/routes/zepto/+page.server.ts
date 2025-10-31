import Postboi from "$library/zepto.js"
import { ZEPTO_TOKEN, EMAIL_FROM_ADDRESS, EMAIL_TO_ADDRESS } from "$env/static/private"
import { fail } from "@sveltejs/kit"

const mail = new Postboi({
	token: ZEPTO_TOKEN,
	default_from: EMAIL_FROM_ADDRESS,
	default_to: EMAIL_TO_ADDRESS,
})

export const actions = {
	async default({ request }) {
		try {
			const response = await mail.send({
				subject: "Test Email",
				body: await request.formData(),
			})
			console.log(response)
			return { success: true }
		} catch (e) {
			if (mail.is_error(e)) {
				console.dir(e.error, { depth: null })
				return fail(400, { error: e.error.message })
			} else return fail(400, { error: String(e) })
		}
	},
}
