const path = require('path')
const dotenv = require('dotenv')

// Load environment variables from .env.local
dotenv.config({ path: path.join(__dirname, '.env.local') })

const { App, LogLevel } = require('@slack/bolt')
const OpenAI = require('openai')

// Initialize OpenAI
const openai = new OpenAI({
	apiKey: process.env.OPENAI_KEY,
})

// Store for installations
const installations = new Map()

// Store for chat histories
const chatHistories = new Map();

// Initialize your app with OAuth
const app = new App({
	signingSecret: process.env.SLACK_SIGNING_SECRET,
	clientId: process.env.SLACK_CLIENT_ID,
	clientSecret: process.env.SLACK_CLIENT_SECRET,
	stateSecret: 'my-state-secret',
	scopes: [
		'commands',
		'chat:write',
		'im:write',
		'im:history',
		'channels:history',
		'users:read'
	],
	installationStore: {
		storeInstallation: async (installation) => {
			if (installation.isEnterpriseInstall && installation.enterprise !== undefined) {
					installations.set(installation.enterprise.id, installation)
					return
			}
			installations.set(installation.team.id, installation)
			if (installation.user && installation.user.token) {
				installations.set(`${installation.team.id}-${installation.user.id}`, installation)
			}
			return
		},
		fetchInstallation: async (installQuery) => {
			let installation
			if (installQuery.isEnterpriseInstall && installQuery.enterpriseId !== undefined) {
				installation = installations.get(installQuery.enterpriseId)
			} else {
				installation = installations.get(installQuery.teamId)
				if (installQuery.userId) {
					const userInstallation = installations.get(`${installQuery.teamId}-${installQuery.userId}`)
					if (userInstallation) {
						return userInstallation
					}
				}
			}
			
			if (installation) {
				return installation
			}
			
			return {
				botToken: process.env.SLACK_BOT_TOKEN,
				botId: installQuery.botId,
				botUserId: installQuery.botUserId,
				teamId: installQuery.teamId
			}
		},
	},
	installerOptions: {
		directInstall: true,
		userScopes: ['chat:write']
	}
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
						'You are a professional editor. Your task is to polish and optimize the given message to make it more professional, clear, and effective while maintaining its original meaning. Keep the tone gentle and professional.',
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
	await ack();

	if (!command.text) {
		await client.chat.postEphemeral({
			token: process.env.SLACK_BOT_TOKEN,
			channel: command.channel_id,
			user: command.user_id,
			text: 'Please provide a message to polish. Usage: `/polish <message>`'
		});
		return;
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
					emoji: true
				},
				blocks: [
					{
						type: 'section',
						text: {
							type: 'mrkdwn',
							text: '✨ *AI is polishing your message...* ✨\n\nThis will just take a moment.'
						}
					}
				]
			}
		});

		// Then process the message
		const polishedMessage = await polishMessage(command.text);
		
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
					emoji: true
				},
				close: {
					type: 'plain_text',
					text: 'Close',
					emoji: true
				},
				blocks: [
					{
						type: 'section',
						text: {
							type: 'mrkdwn',
							text: '*Original Message:*\n' + command.text
						}
					},
					{
						type: 'section',
						text: {
							type: 'mrkdwn',
							text: '✨ *Your polished message is ready:* ✨'
						}
					},
					{
						type: 'section',
						text: {
							type: 'plain_text',
							text: polishedMessage
						}
					},
					{
						type: 'context',
						elements: [
							{
								type: 'mrkdwn',
								text: '👆 *Tip:* Select the text above and use Cmd/Ctrl+C to copy'
							}
						]
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
									emoji: true
								},
								action_id: 'regenerate_polish',
								value: command.text
							}
						]
					}
				],
				private_metadata: JSON.stringify({
					channel_id: command.channel_id,
					original_message: command.text,
					polished_message: polishedMessage
				})
			}
		});
	} catch (error) {
		console.error('Error processing polish command:', error);
		await client.chat.postEphemeral({
			token: process.env.SLACK_BOT_TOKEN,
			channel: command.channel_id,
			user: command.user_id,
			text: 'Sorry, there was an error processing your request. Please try again.'
		});
	}
});

// Handle regenerate button click
app.action('regenerate_polish', async ({ ack, body, client }) => {
	await ack();
	
	try {
		const originalMessage = body.actions[0].value;
		const newPolishedMessage = await polishMessage(originalMessage);
		
		await client.views.update({
			token: process.env.SLACK_BOT_TOKEN,
			view_id: body.view.id,
			view: {
				type: "modal",
				callback_id: "polish_confirm_modal",
				title: {
					type: "plain_text",
					text: "Polished Message",
					emoji: true
				},
				close: {
					type: "plain_text",
					text: "Close",
					emoji: true
				},
				blocks: [
					{
						type: "section",
						text: {
							type: "mrkdwn",
							text: "*Original Message:*\n" + originalMessage
						}
					},
					{
						type: "section",
						text: {
							type: "mrkdwn",
							text: "✨ *Your polished message is ready:* ✨"
						}
					},
					{
						type: "section",
						text: {
							type: "plain_text",
							text: newPolishedMessage
						}
					},
					{
						type: "context",
						elements: [
							{
								type: "mrkdwn",
								text: "👆 *Tip:* Select the text above and use Cmd/Ctrl+C to copy"
							}
						]
					},
					{
						type: "actions",
						block_id: "message_actions",
						elements: [
							{
								type: "button",
								text: {
									type: "plain_text",
									text: "Regenerate",
									emoji: true
								},
								action_id: "regenerate_polish",
								value: originalMessage
							}
						]
					}
				],
				private_metadata: JSON.stringify({
					original_message: originalMessage,
					polished_message: newPolishedMessage
				})
			}
		});
	} catch (error) {
		console.error('Error handling regenerate action:', error);
	}
});

// Function to get chat response
async function getChatResponse(userId, message, history = []) {
	try {
		const messages = [
			{
				role: "system",
				content: "You are a helpful assistant. Format your responses using Slack-compatible markdown when appropriate:\n" +
						"- Use *bold* for emphasis\n" +
						"- Use `code` for code snippets or technical terms\n" +
						"- Use ```language\ncode block``` for multi-line code\n" +
						"- Use > for quotes\n" +
						"- Use • or - for bullet points\n" +
						"Be concise but thorough in your responses."
			},
			...history,
			{ role: "user", content: message }
		];

		const completion = await openai.chat.completions.create({
			model: "gpt-3.5-turbo",
			messages: messages,
		});

		const response = completion.choices[0].message.content;
		return {
			response,
			updatedHistory: [
				...history,
				{ role: "user", content: message },
				{ role: "assistant", content: response }
			]
		};
	} catch (error) {
		console.error('OpenAI API error:', error);
		throw error;
	}
}

// Handle /gpt command
app.command('/gpt', async ({ command, ack, client }) => {
	try {
		// Acknowledge command immediately
		await ack({
			response_type: 'ephemeral',
			text: 'Processing your request...'
		});
		
		const userId = command.user_id;
		const message = command.text;
		
		if (!message) {
			await client.chat.postEphemeral({
				channel: command.channel_id,
				user: userId,
				text: "Please provide a message with the /gpt command"
			});
			return;
		}

		// Open modal with loading state first
		const modalResponse = await client.views.open({
			token: process.env.SLACK_BOT_TOKEN,
			trigger_id: command.trigger_id,
			view: {
				type: "modal",
				callback_id: "gpt_loading_modal",
				title: {
					type: "plain_text",
					text: "Chat with GPT"
				},
				blocks: [
					{
						type: "section",
						text: {
							type: "mrkdwn",
							text: "✨ *GPT is thinking...* ✨"
						}
					}
				]
			}
		});

		// Get chat response
		const { response, updatedHistory } = await getChatResponse(userId, message);
		chatHistories.set(userId, updatedHistory);

		// Update modal with response
		await client.views.update({
			token: process.env.SLACK_BOT_TOKEN,
			view_id: modalResponse.view.id,
			view: {
				type: "modal",
				callback_id: "gpt_chat_modal",
				title: {
					type: "plain_text",
					text: "Chat with GPT"
				},
				blocks: [
					{
						type: "section",
						text: {
							type: "mrkdwn",
							text: "*You:*\n" + message
						}
					},
					{
						type: "divider"
					},
					{
						type: "section",
						text: {
							type: "mrkdwn",
							text: "*GPT:*\n" + response
						}
					},
					{
						type: "divider"
					},
					{
						type: "input",
						block_id: "message_input",
						element: {
							type: "plain_text_input",
							multiline: true,
							action_id: "message",
							placeholder: {
								type: "plain_text",
								text: "Continue the conversation..."
							}
						},
						label: {
							type: "plain_text",
							text: "Your message",
							emoji: true
						}
					}
				],
				submit: {
					type: "plain_text",
					text: "Send Message"
				},
				close: {
					type: "plain_text",
					text: "Close"
				}
			}
		});
	} catch (error) {
		console.error('Error opening GPT chat modal:', error);
		try {
			await client.chat.postEphemeral({
				channel: command.channel_id,
				user: command.user_id,
				text: "Sorry, there was an error processing your request. Please try again."
			});
		} catch (postError) {
			console.error('Error sending error message:', postError);
		}
	}
});

// Handle GPT chat modal submission
app.view('gpt_chat_modal', async ({ ack, body, view, client }) => {
	await ack({
		response_action: "update",
		view: {
			type: "modal",
			title: {
				type: "plain_text",
				text: "Processing...",
				emoji: true
			},
			blocks: [
				{
					type: "section",
					text: {
						type: "mrkdwn",
						text: "✨ *GPT is thinking...* ✨"
					}
				}
			]
		}
	});

	try {
		const message = view.state.values.message_input.message.value;
		const userId = body.user.id;
		const history = chatHistories.get(userId) || [];
		
		// Get response from GPT with conversation history
		const { response, updatedHistory } = await getChatResponse(userId, message, history);
		chatHistories.set(userId, updatedHistory);

		// Create conversation blocks
		const conversationBlocks = [];
		for (let i = 0; i < updatedHistory.length; i += 2) {
			// Add user message
			conversationBlocks.push({
				type: "section",
				text: {
					type: "mrkdwn",
					text: "*You:*\n" + updatedHistory[i].content
				}
			});

			// Add divider
			conversationBlocks.push({
				type: "divider"
			});

			// Add GPT response
			if (updatedHistory[i + 1]) {
				conversationBlocks.push({
					type: "section",
					text: {
						type: "mrkdwn",
						text: "*GPT:*\n" + updatedHistory[i + 1].content
					}
				});

				// Add divider
				conversationBlocks.push({
					type: "divider"
				});
			}
		}

		// Add input field for next message
		conversationBlocks.push({
			type: "input",
			block_id: "message_input",
			element: {
				type: "plain_text_input",
				multiline: true,
				action_id: "message",
				placeholder: {
					type: "plain_text",
					text: "Continue the conversation..."
				}
			},
			label: {
				type: "plain_text",
				text: "Your message",
				emoji: true
			}
		});

		// Update modal with conversation
		await client.views.update({
			token: process.env.SLACK_BOT_TOKEN,
			view_id: body.view.id,
			view: {
				type: "modal",
				callback_id: "gpt_chat_modal",
				title: {
					type: "plain_text",
					text: "Chat with GPT",
					emoji: true
				},
				blocks: conversationBlocks,
				submit: {
					type: "plain_text",
					text: "Send",
					emoji: true
				},
				close: {
					type: "plain_text",
					text: "Close",
					emoji: true
				}
			}
		});
	} catch (error) {
		console.error('Error processing GPT chat:', error);
		await client.views.update({
			token: process.env.SLACK_BOT_TOKEN,
			view_id: body.view.id,
			view: {
				type: "modal",
				title: {
					type: "plain_text",
					text: "Error",
					emoji: true
				},
				blocks: [
					{
						type: "section",
						text: {
							type: "mrkdwn",
							text: "Sorry, there was an error processing your request. Please try again."
						}
					}
				],
				close: {
					type: "plain_text",
					text: "Close",
					emoji: true
				}
			}
		});
	}
});

// Start your app
;(async () => {
	try {
		await app.start(process.env.PORT || 3000)
		console.log('⚡️ Bolt app is running!')
	} catch (error) {
		console.error('Error starting the app:', error)
	}
})()
