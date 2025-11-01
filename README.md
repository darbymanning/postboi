<div align="center">
  <img src="https://raw.githubusercontent.com/darbymanning/postboi/refs/heads/main/static/logo.svg" alt="Postboi" width="250" />

**Gotta emails son? This here ya boi**

[![CI](https://github.com/darbymanning/postboi/actions/workflows/ci.yml/badge.svg)](https://github.com/darbymanning/postboi/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/postboi)](https://www.npmjs.com/package/postboi)

</div>

---

Postboi is a dead simple email library that works anywhere you can run JavaScript/TypeScript, but it's optimized for SvelteKit. It's got a provider-based architecture so you can swap email providers whenever you fancy, plus some genuinely useful form handling that turns your FormData into tidy HTML emails without you having to write a single line of HTML yourself.

The core email sending functionality is framework-agnostic and works in Node.js, Bun, Deno, or edge runtimes.

### Features

- 🔌 **Provider-based** - swap email providers without changing your code
- 📝 **Smart FormData parsing** - automatically converts FormData to HTML tables
- 🎯 **Grouped fields** - organize form fields with `fieldset→field` syntax
- 📎 **Attachments** - attach files directly from form inputs or file objects
- 🛡️ **Type-safe** - full TypeScript support with proper error handling
- ⚡ **zero bullshit** - no unnecessary abstractions, just works

## Providers

Currently supported:

- ✅ **ZeptoMail** — fully implemented and tested
- ... oh, yeah, that's it 😅

Want to add another provider? Quit being a baby and open a PR.

## Installation

```bash
# if you're cool
bun add postboi

# or if you used to be cool
pnpm add postboi

# or if you're weird
yarn add postboi

# or if you smell like used knickers
npm install postboi
```

## Quick Start

### Basic Usage with ZeptoMail

```typescript
import Postboi from "postboi/zepto"

const mail = new Postboi({
	token: "your-zeptomail-api-token",
	default_from: "no-reply@example.com",
	default_to: "contact@example.com",
})

// simple string body
await mail.send({
	to: "someone@example.com",
	subject: "hello",
	body: "hello world",
})
```

### With SvelteKit Form Actions

```typescript
// +page.server.ts
import Postboi from "postboi/zepto"
import { ZEPTO_TOKEN, EMAIL_FROM_ADDRESS, EMAIL_TO_ADDRESS } from "$env/static/private"
import { fail } from "@sveltejs/kit"

const mail = new Postboi({
	token: ZEPTO_TOKEN,
	default_from: EMAIL_FROM_ADDRESS,
	default_to: EMAIL_TO_ADDRESS,
})

export const actions = {
	async default({ request }) {
		const form_data = await request.formData()

		try {
			await mail.send({ body: form_data })
			return { success: true }
		} catch (error) {
			if (mail.is_error(error)) {
				return fail(400, { error: error.error.message })
			}
			return fail(400, { error: String(error) })
		}
	},
}
```

```svelte
<!-- +page.svelte -->
<script lang="ts">
	import { enhance } from "$app/forms"
</script>

<form method="POST" use:enhance enctype="multipart/form-data">
	<input type="hidden" name="_subject" value="Contact Form" />

	<input name="contact→name" placeholder="Name" required />
	<input name="contact→email" type="email" placeholder="Email" required />
	<textarea name="details→message" placeholder="Message" />

	<input type="file" name="details→attachments" multiple />

	<button type="submit">Send</button>
</form>
```

That's it. The FormData automatically becomes a nice HTML table in the email.

## FormData Magic

Postboi handles FormData intelligently. Here's what it does:

### Special Fields

These fields get extracted and don't appear in the email body:

- `_to` — recipient address (overrides default)
- `_from` — sender address (overrides default)
- `_subject` — email subject
- `_reply_to` — reply-to address
- `_cc` — cc addresses (comma-separated or array)
- `_bcc` — bcc addresses (comma-separated or array)

All special field values can be base64 encoded and will be automatically decoded.

### Grouped Fields

Use `fieldset→field` syntax to group related fields:

```html
<input name="contact→name" />
<input name="contact→email" />
<input name="contact→phone" />

<input name="order→product" />
<input name="order→quantity" />
```

This creates sections with headers in the email:

```
Contact
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Name:     John Doe
Email:    john@example.com
Phone:    +44 1234 567890

Order
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Product:  Widget Pro
Quantity: 2
```

### Attachments

Files are automatically detected and attached:

```html
<input type="file" name="details→files" multiple />
```

Or programmatically:

```typescript
await mail.send({
	to: "someone@example.com",
	body: "check these out",
	attachments: [file1, file2], // File objects or array
})
```

## Email Address Formats

Postboi accepts multiple email formats because flexibility is good:

```typescript
// plain string
'user@example.com'

// object with display name
{ address: 'user@example.com', name: 'User Name' }

// Display-name format (RFC 5322)
'User Name <user@example.com>'

// arrays for multiple recipients
['user1@example.com', 'user2@example.com']

// mixed formats in arrays
[
  'user1@example.com',
  { address: 'user2@example.com', name: 'User Two' },
  'User Three <user3@example.com>'
]
```

## API Reference

### `Postboi` Class (ZeptoMail Provider)

```typescript
import Postboi from 'postboi/zepto'

const mail = new Postboi({
  token: string                    // ZeptoMail API token (required)
  default_from?: string            // default sender address
  default_to?: string              // default recipient address
})

// send email
await mail.send(options: SendOptions): Promise<SendResponse>

// check if error is a ZeptoMail error
mail.is_error(error: unknown): error is SendError
```

### `SendOptions`

```typescript
interface SendOptions {
	to?: Email | Email[] // recipient(s)
	from?: Email // sender
	reply_to?: Email | Email[] // reply-to address(es)
	cc?: Email | Email[] // cc recipient(s)
	bcc?: Email | Email[] // bcc recipient(s)
	subject?: string // email subject (default: "Mail sent from website")
	body: string | FormData // email body or formdata to parse
	formatter?:
		| {
				// customize label formatting
				fieldset?: ((label: string) => string) | null | false
				name?: ((label: string) => string) | null | false
		  }
		| null
		| false // set to null/false to disable formatting
	attachments?: File | File[] // file attachments
}
```

### `Email` Type

```typescript
type Email =
	| string // plain address or "Name <address>"
	| { address: string; name?: string }
```

### Error Handling

```typescript
try {
	await mail.send({ to: "bad@email", body: "test" })
} catch (error) {
	if (mail.is_error(error)) {
		// ZeptoMail error with structure
		console.error(error.error.code) // error code
		console.error(error.error.message) // error message
		console.error(error.error.request_id) // request ID for support
	} else {
		// generic error
		console.error(error)
	}
}
```

## Development

```bash
# install dependencies
bun install

# start dev server
bun run dev

# type checking
bun run check

# linting
bun run lint

# run tests
bun run test

# build library
bun run build
```

## Testing

The test suite uses Vitest and mocks the ZeptoMail client:

```bash
bun run test        # run tests once
bun run test:unit   # watch mode
```

## Contributing

PRs welcome! Especially for new email providers. Make sure you:

- Follow the existing code style (snake_case, no semicolons)
- Add tests for new features
- Run `bun run check` and `bun run lint` before pushing
