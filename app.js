const { App, LogLevel } = require('@slack/bolt')
const OpenAI = require('openai')

// Initialize OpenAI with custom configuration
const openai = new OpenAI({
	apiKey: process.env.OPENAI_KEY,
})

// Store for chat histories (consider using a proper database for production)
const chatHistories = new Map()

// Initialize the app with environment-specific settings
const app = new App({
	signingSecret: process.env.SLACK_SIGNING_SECRET,
	token: process.env.SLACK_BOT_TOKEN,
	// Enable request processing before response for Vercel
	processBeforeResponse: true,
	// Custom logging
	logLevel: LogLevel.WARN,
})

// Function to polish message using OpenAI
async function polishMessage(message) {
	try {
		const completion = await openai.chat.completions.create({
			model: 'gpt-3.5-turbo',
			messages: [
				{
					role: 'system',
					content:
						'You are a professional editor and translator. Your task is to process messages based on their language:\n\n' +
						'For English input:\n' +
						'1. Correct any grammatical errors and improve spelling\n' +
						'2. Enhance clarity and professionalism while maintaining the original tone\n' +
						'3. Restructure sentences if needed for better flow\n' +
						'4. Keep the style natural and appropriate for business communication\n\n' +
						'For Chinese input:\n' +
						'1. Translate the message into professional English\n' +
						'2. Ensure the translation captures cultural nuances\n' +
						'3. Polish the translated text for clarity and impact\n' +
						'4. Maintain the original intent and tone\n\n' +
						'Guidelines:\n' +
						'• Preserve any technical terms or proper nouns\n' +
						'• Keep the message concise but complete\n' +
						'• For Chinese to English translation, add the original Chinese text in parentheses at the end\n' +
						'• If making significant changes, briefly explain the improvements made',
				},
				{
					role: 'user',
					content: message,
				},
			],
		})

		return completion.choices[0].message.content
	} catch (error) {
		console.error('OpenAI API error:', error)
		throw error
	}
}

// Listen for a message containing "hello"
app.message('hello', async ({ message, say }) => {
	await say(`Hey there <@${message.user}>! 👋`)
})

// Handle /polish command
app.command('/polish', async ({ command, ack, client, body }) => {
	await ack()

	if (!command.text) {
		await client.chat.postEphemeral({
			token: process.env.SLACK_BOT_TOKEN,
			channel: command.channel_id,
			user: command.user_id,
			text: 'Please provide a message to polish. Usage: `/polish <message>`',
		})
		return
	}

	try {
		// First, open the modal with a loading state
		const modalResponse = await client.views.open({
			token: process.env.SLACK_BOT_TOKEN,
			trigger_id: body.trigger_id,
			view: {
				type: 'modal',
				callback_id: 'polish_loading_modal',
				title: {
					type: 'plain_text',
					text: 'Polishing Message...',
					emoji: true,
				},
				blocks: [
					{
						type: 'section',
						text: {
							type: 'mrkdwn',
							text: '✨ *AI is polishing your message...* ✨\n\nThis will just take a moment.',
						},
					},
				],
			},
		})

		// Then process the message
		const polishedMessage = await polishMessage(command.text)

		// Update the modal with results
		await client.views.update({
			token: process.env.SLACK_BOT_TOKEN,
			view_id: modalResponse.view.id,
			view: {
				type: 'modal',
				callback_id: 'polish_confirm_modal',
				title: {
					type: 'plain_text',
					text: 'Polished Message',
					emoji: true,
				},
				close: {
					type: 'plain_text',
					text: 'Close',
					emoji: true,
				},
				blocks: [
					{
						type: 'section',
						text: {
							type: 'mrkdwn',
							text: '*Original Message:*\n' + command.text,
						},
					},
					{
						type: 'divider',
					},
					{
						type: 'section',
						text: {
							type: 'mrkdwn',
							text: '✨ *Enhanced Message:* ✨\n' + polishedMessage,
						},
					},
					{
						type: 'context',
						elements: [
							{
								type: 'mrkdwn',
								text: '👆 *Tip:* Select the text above and use Cmd/Ctrl+C to copy. For Chinese text, the English translation is shown first, followed by the original text in parentheses.',
							},
						],
					},
					{
						type: 'actions',
						block_id: 'message_actions',
						elements: [
							{
								type: 'button',
								text: {
									type: 'plain_text',
									text: 'Regenerate',
									emoji: true,
								},
								action_id: 'regenerate_polish',
								value: command.text,
							},
						],
					},
				],
				private_metadata: JSON.stringify({
					channel_id: command.channel_id,
					original_message: command.text,
					polished_message: polishedMessage,
				}),
			},
		})
	} catch (error) {
		console.error('Error processing polish command:', error)
		await client.chat.postEphemeral({
			token: process.env.SLACK_BOT_TOKEN,
			channel: command.channel_id,
			user: command.user_id,
			text: 'Sorry, there was an error processing your request. Please try again.',
		})
	}
})

// Handle regenerate button click
app.action('regenerate_polish', async ({ ack, body, client }) => {
	await ack()

	try {
		const originalMessage = body.actions[0].value
		const newPolishedMessage = await polishMessage(originalMessage)

		await client.views.update({
			token: process.env.SLACK_BOT_TOKEN,
			view_id: body.view.id,
			view: {
				type: 'modal',
				callback_id: 'polish_confirm_modal',
				title: {
					type: 'plain_text',
					text: 'Polished Message',
					emoji: true,
				},
				close: {
					type: 'plain_text',
					text: 'Close',
					emoji: true,
				},
				blocks: [
					{
						type: 'section',
						text: {
							type: 'mrkdwn',
							text: '*Original Message:*\n' + originalMessage,
						},
					},
					{
						type: 'divider',
					},
					{
						type: 'section',
						text: {
							type: 'mrkdwn',
							text: '✨ *Enhanced Message:* ✨\n' + newPolishedMessage,
						},
					},
					{
						type: 'context',
						elements: [
							{
								type: 'mrkdwn',
								text: '👆 *Tip:* Select the text above and use Cmd/Ctrl+C to copy. For Chinese text, the English translation is shown first, followed by the original text in parentheses.',
							},
						],
					},
					{
						type: 'actions',
						block_id: 'message_actions',
						elements: [
							{
								type: 'button',
								text: {
									type: 'plain_text',
									text: 'Regenerate',
									emoji: true,
								},
								action_id: 'regenerate_polish',
								value: originalMessage,
							},
						],
					},
				],
				private_metadata: JSON.stringify({
					original_message: originalMessage,
					polished_message: newPolishedMessage,
				}),
			},
		})
	} catch (error) {
		console.error('Error handling regenerate action:', error)
	}
})

// Function to ensure correct Slack markdown formatting
function formatForSlack(text) {
	// Replace double asterisks with single asterisks for bold text
	return text.replace(/\*\*(.*?)\*\*/g, '*$1*')
}

// Function to get chat response
async function getChatResponse(userId, message, history = []) {
	try {
		const messages = [
			{
				role: 'system',
				content:
					'You are a knowledgeable AI Assistant specializing in software development and technical topics. ' +
					'CRITICAL: You must use ONLY these Slack-compatible markdown formats:\n' +
					'1. For bold text: Use *text* (NEVER use ** - it is not supported)\n' +
					'2. For italic text: Use _text_ (single underscore only)\n' +
					'3. For strikethrough: Use ~text~\n' +
					'4. For code: Use `text` for inline, ```language\ncode\n``` for blocks\n' +
					'5. For quotes: Use > for single line, >>> for multiple lines\n' +
					'6. For lists: Use • or - for bullet points, 1. 2. 3. for numbered\n' +
					'7. For links: Use <URL> or <URL|text>\n' +
					'8. For emojis: Use :emoji_name: (e.g., :smile:)\n\n' +
					'IMPORTANT: Always use single asterisk *like this* for bold text, never double asterisks.\n\n' +
					'When answering questions:\n' +
					'1. Start with a brief explanation\n' +
					'2. Provide practical examples\n' +
					'3. Include best practices\n' +
					'4. Add helpful resources\n' +
					'Be thorough but concise, and focus on practical advice.',
			},
			...history,
			{ role: 'user', content: message },
		]

		const completion = await openai.chat.completions.create({
			model: 'gpt-3.5-turbo',
			messages: messages,
		})

		// Format the response to ensure correct Slack markdown
		const response = formatForSlack(completion.choices[0].message.content)
		return {
			response,
			updatedHistory: [...history, { role: 'user', content: message }, { role: 'assistant', content: response }],
		}
	} catch (error) {
		console.error('OpenAI API error:', error)
		throw error
	}
}

// Handle /gpt command
app.command('/gpt', async ({ command, ack, client }) => {
	try {
		// Acknowledge command with a longer timeout
		await ack()

		const userId = command.user_id
		const message = command.text

		if (!message) {
			await client.chat.postEphemeral({
				channel: command.channel_id,
				user: userId,
				text: 'Please provide a message with the /gpt command',
			})
			return
		}

		// Open modal with loading state first
		const modalResponse = await client.views.open({
			token: process.env.SLACK_BOT_TOKEN,
			trigger_id: command.trigger_id,
			view: {
				type: 'modal',
				callback_id: 'gpt_loading_modal',
				title: {
					type: 'plain_text',
					text: 'Chat with GPT',
				},
				blocks: [
					{
						type: 'section',
						text: {
							type: 'mrkdwn',
							text: '✨ *GPT is thinking...* ✨',
						},
					},
					{
						type: 'context',
						elements: [
							{
								type: 'mrkdwn',
								text: 'This might take a moment for longer responses.',
							},
						],
					},
				],
			},
		})

		// Get chat response in a separate try-catch block
		try {
			const { response, updatedHistory } = await getChatResponse(userId, message)
			chatHistories.set(userId, updatedHistory)

			// Update modal with response
			await client.views.update({
				token: process.env.SLACK_BOT_TOKEN,
				view_id: modalResponse.view.id,
				view: {
					type: 'modal',
					callback_id: 'gpt_chat_modal',
					title: {
						type: 'plain_text',
						text: 'Chat with GPT',
					},
					blocks: [
						{
							type: 'section',
							text: {
								type: 'mrkdwn',
								text: '*You:*\n' + message,
							},
						},
						{
							type: 'divider',
						},
						{
							type: 'section',
							text: {
								type: 'mrkdwn',
								text: '*GPT:*\n' + response,
							},
						},
						{
							type: 'divider',
						},
						{
							type: 'input',
							block_id: 'message_input',
							element: {
								type: 'plain_text_input',
								multiline: true,
								action_id: 'message',
								placeholder: {
									type: 'plain_text',
									text: 'Continue the conversation...',
								},
							},
							label: {
								type: 'plain_text',
								text: 'Your message',
								emoji: true,
							},
						},
					],
					submit: {
						type: 'plain_text',
						text: 'Send Message',
					},
					close: {
						type: 'plain_text',
						text: 'Close',
					},
				},
			})
		} catch (gptError) {
			// Only show error in modal if we failed to get a response
			console.error('Error getting GPT response:', gptError)
			await client.views.update({
				token: process.env.SLACK_BOT_TOKEN,
				view_id: modalResponse.view.id,
				view: {
					type: 'modal',
					title: {
						type: 'plain_text',
						text: 'Processing...',
					},
					blocks: [
						{
							type: 'section',
							text: {
								type: 'mrkdwn',
								text: 'Still processing your request. Please wait or try again with a shorter message.',
							},
						},
					],
					close: {
						type: 'plain_text',
						text: 'Close',
					},
				},
			})
		}
	} catch (error) {
		console.error('Error in /gpt command:', error)
		// Only send error message if we failed to open the modal
		if (!error.message.includes('operation_timeout')) {
			try {
				await client.chat.postEphemeral({
					channel: command.channel_id,
					user: command.user_id,
					text: 'Sorry, there was an error starting the conversation. Please try again.',
				})
			} catch (postError) {
				console.error('Error sending error message:', postError)
			}
		}
	}
})

// Handle GPT chat modal submission
app.view('gpt_chat_modal', async ({ ack, body, view, client }) => {
	// Simple acknowledgment first
	await ack()

	// Then update the view to show loading state
	await client.views.update({
		token: process.env.SLACK_BOT_TOKEN,
		view_id: body.view.id,
		view: {
			type: 'modal',
			title: {
				type: 'plain_text',
				text: 'Processing...',
				emoji: true,
			},
			blocks: [
				{
					type: 'section',
					text: {
						type: 'mrkdwn',
						text: '✨ *GPT is thinking...* ✨',
					},
				},
			],
		},
	})

	try {
		const message = view.state.values.message_input.message.value
		const userId = body.user.id
		const history = chatHistories.get(userId) || []

		// Get response from GPT with conversation history
		const { response, updatedHistory } = await getChatResponse(userId, message, history)
		chatHistories.set(userId, updatedHistory)

		// Create conversation blocks
		const conversationBlocks = []
		for (let i = 0; i < updatedHistory.length; i += 2) {
			// Add user message
			conversationBlocks.push({
				type: 'section',
				text: {
					type: 'mrkdwn',
					text: '*You:*\n' + updatedHistory[i].content,
				},
			})

			// Add divider
			conversationBlocks.push({
				type: 'divider',
			})

			// Add GPT response
			if (updatedHistory[i + 1]) {
				conversationBlocks.push({
					type: 'section',
					text: {
						type: 'mrkdwn',
						text: '*GPT:*\n' + updatedHistory[i + 1].content,
					},
				})

				// Add divider
				conversationBlocks.push({
					type: 'divider',
				})
			}
		}

		// Add input field for next message
		conversationBlocks.push({
			type: 'input',
			block_id: 'message_input',
			element: {
				type: 'plain_text_input',
				multiline: true,
				action_id: 'message',
				placeholder: {
					type: 'plain_text',
					text: 'Continue the conversation...',
				},
			},
			label: {
				type: 'plain_text',
				text: 'Your message',
				emoji: true,
			},
		})

		// Update modal with conversation
		await client.views.update({
			token: process.env.SLACK_BOT_TOKEN,
			view_id: body.view.id,
			view: {
				type: 'modal',
				callback_id: 'gpt_chat_modal',
				title: {
					type: 'plain_text',
					text: 'Chat with GPT',
					emoji: true,
				},
				blocks: conversationBlocks,
				submit: {
					type: 'plain_text',
					text: 'Send',
					emoji: true,
				},
				close: {
					type: 'plain_text',
					text: 'Close',
					emoji: true,
				},
			},
		})
	} catch (error) {
		console.error('Error processing GPT chat:', error)
		await client.views.update({
			token: process.env.SLACK_BOT_TOKEN,
			view_id: body.view.id,
			view: {
				type: 'modal',
				title: {
					type: 'plain_text',
					text: 'Error',
					emoji: true,
				},
				blocks: [
					{
						type: 'section',
						text: {
							type: 'mrkdwn',
							text: 'Sorry, there was an error processing your request. Please try again.',
						},
					},
				],
				close: {
					type: 'plain_text',
					text: 'Close',
					emoji: true,
				},
			},
		})
	}
})

// Handle app mentions (@AI Assistant)
app.event('app_mention', async ({ event, client, say }) => {
	try {
		// Extract the question (remove the bot mention)
		const question = event.text.replace(/<@[^>]+>/, '').trim()

		if (!question) {
			await client.chat.postMessage({
				token: process.env.SLACK_BOT_TOKEN,
				channel: event.channel,
				thread_ts: event.thread_ts || event.ts,
				text:
					"Hello! 👋 I'm your AI Assistant. You can ask me any technical questions, and I'll help you out. For example:\n" +
					'• How to configure a package.json?\n' +
					'• What are the best practices for error handling?\n' +
					'• How to implement authentication?',
			})
			return
		}

		// Show typing indicator
		const typingResponse = await client.chat.postMessage({
			token: process.env.SLACK_BOT_TOKEN,
			channel: event.channel,
			thread_ts: event.thread_ts || event.ts,
			text: '✨ *Processing your question...* ✨',
		})

		// Get response from GPT with technical context
		const { response } = await getChatResponse(
			event.user,
			`Technical question about: ${question}\n` +
				`Please provide a detailed, well-structured answer with examples where appropriate. ` +
				`Use markdown formatting for code snippets and key points.`
		)

		// Update the typing message with the actual response
		await client.chat.update({
			token: process.env.SLACK_BOT_TOKEN,
			channel: event.channel,
			ts: typingResponse.ts,
			text: response,
			blocks: [
				{
					type: 'section',
					text: {
						type: 'mrkdwn',
						text: response,
					},
				},
				{
					type: 'context',
					elements: [
						{
							type: 'mrkdwn',
							text: '💡 _Feel free to ask follow-up questions in this thread!_',
						},
					],
				},
			],
		})
	} catch (error) {
		console.error('Error handling app mention:', error)
		await client.chat.postMessage({
			token: process.env.SLACK_BOT_TOKEN,
			channel: event.channel,
			thread_ts: event.thread_ts || event.ts,
			text: 'Sorry, I encountered an error while processing your request. Please try again.',
		})
	}
})

// Start your app
;(async () => {
	try {
		const port = process.env.PORT || 3000
		await app.start(port)
		console.log(`⚡️ Bolt app is running on port ${port}!`)
	} catch (error) {
		console.error('Error starting the app:', error)
		process.exit(1)
	}
})()
