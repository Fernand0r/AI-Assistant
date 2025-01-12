const path = require('path');
const dotenv = require('dotenv');
const { spawn } = require('child_process');
const ngrok = require('ngrok');

// Load environment variables from .env.local
dotenv.config({ path: path.join(__dirname, '.env.local') });

// Start the Slack app
const slackApp = spawn('node', ['app.js'], {
	stdio: 'inherit',
})

// Start ngrok
;(async function () {
	try {
		// Configure ngrok
		await ngrok.authtoken(process.env.NGROK_AUTHTOKEN)

		const url = await ngrok.connect({
			addr: 3000, // Port where your Slack app is running
			proto: 'http',
		})
		console.log('🌍 Ngrok tunnel created:', url)
		console.log('⚡ Update your Slack app Request URL to:', url + '/slack/events')
	} catch (error) {
		console.error('Error starting ngrok:', error)
		process.exit(1)
	}
})()

// Handle process termination
process.on('SIGINT', async () => {
	console.log('\nShutting down...')
	await ngrok.kill()
	slackApp.kill()
	process.exit(0)
})
