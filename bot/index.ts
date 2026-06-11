import { Client, GatewayIntentBits, Message } from 'discord.js'
import 'dotenv/config'

const AURORA_URL = 'http://localhost:3001/api/chat/sync'
const PREFIX = '!aurora'
const DISCORD_TOKEN = process.env.DISCORD_BOT_TOKEN

if (!DISCORD_TOKEN) {
  console.error('DISCORD_BOT_TOKEN not set in .env')
  process.exit(1)
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
})

// Per-channel conversation history (in-memory, resets on bot restart)
const channelHistory = new Map<string, Array<{ role: 'user' | 'assistant'; content: string }>>()

const MAX_HISTORY = 20  // messages kept per channel
const DISCORD_MAX = 2000

function splitMessage(text: string): string[] {
  if (text.length <= DISCORD_MAX) return [text]
  const chunks: string[] = []
  let remaining = text
  while (remaining.length > 0) {
    // Try to split on a newline near the limit
    let cut = DISCORD_MAX
    if (remaining.length > DISCORD_MAX) {
      const lastNewline = remaining.lastIndexOf('\n', DISCORD_MAX)
      cut = lastNewline > DISCORD_MAX / 2 ? lastNewline + 1 : DISCORD_MAX
    }
    chunks.push(remaining.slice(0, cut))
    remaining = remaining.slice(cut)
  }
  return chunks
}

client.on('messageCreate', async (msg: Message) => {
  if (msg.author.bot) return
  if (!msg.content.toLowerCase().startsWith(PREFIX)) return

  const userText = msg.content.slice(PREFIX.length).trim()
  if (!userText) {
    await msg.reply('Usage: `!aurora <your question>`')
    return
  }

  // Show typing indicator while Aurora thinks
  await msg.channel.sendTyping()

  const channelId = msg.channelId
  const history = channelHistory.get(channelId) ?? []
  history.push({ role: 'user', content: userText })

  let responseText = ''
  try {
    const response = await fetch(AURORA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: history,
        system: 'You are Aurora, a Capsuleer Intelligence System for EVE Online. You are responding via Discord — keep answers concise and avoid heavy markdown tables when possible.',
      }),
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: response.statusText }))
      throw new Error((err as { error: string }).error || response.statusText)
    }

    const data = await response.json() as { text: string }
    responseText = data.text || '_(no response)_'
  } catch (err) {
    console.error('Aurora request failed:', err)
    await msg.reply('Aurora is offline or encountered an error. Make sure the Express server is running.')
    return
  }

  history.push({ role: 'assistant', content: responseText })

  // Trim history to keep context manageable
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY)
  channelHistory.set(channelId, history)

  // Send reply, splitting if over Discord's 2000 char limit
  const chunks = splitMessage(responseText)
  await msg.reply(chunks[0])
  for (const chunk of chunks.slice(1)) {
    await msg.channel.send(chunk)
  }
})

client.once('ready', () => {
  console.log(`Aurora bot online as ${client.user?.tag}`)
})

client.login(DISCORD_TOKEN)
