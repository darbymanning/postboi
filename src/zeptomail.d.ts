declare module "zeptomail" {
	namespace Zepto {
		interface EmailAddress {
			address: string
			name?: string
		}

		type Attachment =
			| {
					name: string
					content: string
					mime_type: string
			  }
			| { file_cache_key: string }

		interface SendMailParams {
			from: EmailAddress
			to: Array<{ email_address: EmailAddress }>
			reply_to?: Array<EmailAddress>
			bcc?: Array<{ email_address: EmailAddress }>
			cc?: Array<{ email_address: EmailAddress }>
			attachments?: Array<Attachment>
			subject: string
			htmlbody: string
		}

		type Error = {
			error: {
				code: string
				details: Array<{
					code: string
					message: string
					inner_error?: { code: string; message: string }
					target?: string
				}>
				message: string
				request_id: string
			}
		}

		type SendMailResponse = {
			data: Array<{
				code: string
				additional_info: unknown[]
				message: string
			}>
			message: string
			request_id: string
			object: "email"
		}
	}

	export class SendMailClient {
		constructor(options: { url: string; token: string })

		sendMail(options: Zepto.SendMailParams): Promise<Zepto.SendMailResponse>
	}
}
