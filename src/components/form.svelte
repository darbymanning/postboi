<script lang="ts">
	import { enhance } from "$app/forms"
	import * as Breadcrumb from "./ui/breadcrumb/index.js"
	import { Button } from "./ui/button/index.js"
	import * as Card from "./ui/card/index.js"
	import * as Field from "./ui/field/index.js"
	import { Input } from "./ui/input/index.js"
	import { Textarea } from "./ui/textarea/index.js"
	import { page } from "$app/state"
	import { toast } from "svelte-sonner"

	interface Props {
		provider: string
	}

	let { provider }: Props = $props()

	let contact = $state({
		name: "",
		email: "",
	})

	$effect(() => {
		if (page.form?.error) toast.error(page.form.error)
		else if (page.form?.success) toast.success("Email sent successfully")
	})
</script>

<Breadcrumb.Root class="sticky top-0 z-10 mb-8 border-b bg-background/50 p-4 backdrop-blur-2xl">
	<Breadcrumb.List>
		<Breadcrumb.Item>
			<Breadcrumb.Link href="/">Home</Breadcrumb.Link>
		</Breadcrumb.Item>
		<Breadcrumb.Separator />
		<Breadcrumb.Item>
			<Breadcrumb.Page>{provider}</Breadcrumb.Page>
		</Breadcrumb.Item>
	</Breadcrumb.List>
</Breadcrumb.Root>

<Card.Root class="mx-auto mb-8 w-full max-w-2xl">
	<Card.Header class="flex flex-col items-center justify-center">
		<img src="/logo.svg" alt="Postboi" class="w-52" />
	</Card.Header>
	<Card.Content>
		<form method="POST" use:enhance enctype="multipart/form-data">
			<input type="hidden" name="_subject" value="Order Confirmation" />
			<input
				type="hidden"
				name="_reply_to"
				value={contact.name ? `${contact.name} <${contact.email}>` : contact.email}
			/>
			<Field.Group>
				<Field.Set>
					<Field.Legend>Contact</Field.Legend>
					<Field.Description>Enter your name and email below</Field.Description>
					<Field.Group>
						<Field.Field>
							<Field.Label for="name">Name</Field.Label>
							<Input id="name" name="contact→name" required bind:value={contact.name} />
						</Field.Field>
						<Field.Field>
							<Field.Label for="email">Email</Field.Label>
							<Input
								id="email"
								name="contact→email"
								type="email"
								required
								bind:value={contact.email}
							/>
						</Field.Field>
					</Field.Group>
				</Field.Set>
				<Field.Separator />
				<Field.Set>
					<Field.Group>
						<Field.Field>
							<Field.Label for="attachments">Attachments</Field.Label>
							<Input type="file" name="details→attachments" multiple />
							<Field.Description>Add any additional attachments</Field.Description>
						</Field.Field>
						<Field.Field>
							<Field.Label for="message">Message</Field.Label>
							<Textarea
								id="message"
								placeholder="Add any additional information"
								class="resize-none"
								name="details→message"
							/>
						</Field.Field>
					</Field.Group>
				</Field.Set>
				<Field.Field orientation="horizontal">
					<Button type="submit">Submit</Button>
				</Field.Field>
			</Field.Group>
		</form>
	</Card.Content>
</Card.Root>
