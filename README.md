# OpenClaw MCP Server 🏰

Expose your [OpenClaw](https://openclaw.ai) assistant to Claude Desktop (or any MCP client) via **Streamable HTTP** transport.

This allows you to interact with your OpenClaw assistant from Claude Desktop, effectively bridging two AI systems.

## ✨ Features

- **Streamable HTTP transport** — proper MCP spec implementation
- **SSE streaming** — real-time responses
- **API Key authentication** — secure remote access
- **Easy installation** — one script to set everything up
- **Configurable** — customize bot name, session label, port
- **systemd integration** — auto-start on boot

## 🚀 Quick Install

On the server where OpenClaw is running:

```bash
# Clone the repo
git clone https://github.com/rodgco/openclaw-mcp-server.git
cd openclaw-mcp-server

# Run installer
./install.sh
```

The installer will:
1. ✅ Check for Node.js 18+ and OpenClaw
2. 📦 Install dependencies
3. 🔑 Generate an API key
4. ⚙️ Ask for your bot name and session label
5. 🚀 Optionally create a systemd service
6. 📋 Output the Claude Desktop configuration

## 📋 Manual Installation

If you prefer manual setup:

```bash
# Clone and install
git clone https://github.com/rodgco/openclaw-mcp-server.git
cd openclaw-mcp-server
npm install

# Configure
cp .env.example .env
# Edit .env with your settings

# Generate API key
openssl rand -base64 32

# Run
npm start
```

## ⚙️ Configuration

Edit `.env` file:

```bash
# Name of your assistant/bot
BOT_NAME="MyAssistant"

# OpenClaw session label to connect to
OPENCLAW_SESSION_LABEL="main"

# API Key (generate with: openssl rand -base64 32)
MCP_SERVER_API_KEY="your-secret-key-here"

# Port to listen on
PORT=3721

# Bind address (0.0.0.0 for all interfaces)
BIND_ADDRESS="0.0.0.0"

# OpenClaw workspace path
OPENCLAW_WORKSPACE="${HOME}/.openclaw/workspace"
```

## 🖥️ Claude Desktop Configuration

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "myassistant": {
      "transport": "streamable-http",
      "url": "http://YOUR_SERVER_IP:3721/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

**Config file locations:**
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

## 🛠️ Available Tools

Once connected, Claude Desktop can use these tools:

### `ask`
Send a message or question to your OpenClaw assistant.

### `memory_search`
Search the assistant's long-term memory (MEMORY.md).

### `sessions_status`
Check OpenClaw session status.

## 📡 How It Works

```
Claude Desktop (your computer)
    ↕️ HTTP POST/GET + SSE
http://your-server:3721/mcp
    ↕️
openclaw-mcp-server
    ↕️ openclaw sessions send
OpenClaw Assistant (remote server)
```

1. Claude Desktop sends JSON-RPC requests via HTTP POST
2. MCP server forwards messages to OpenClaw session
3. Responses stream back via Server-Sent Events (SSE)

## 🔧 systemd Service

If you installed with the script and chose systemd:

```bash
# Check status
sudo systemctl status openclaw-mcp-server

# View logs
sudo journalctl -u openclaw-mcp-server -f

# Restart
sudo systemctl restart openclaw-mcp-server
```

## 🔒 Security

- **API Key required** for all MCP requests
- **Tailscale recommended** for secure remote access
- Never expose port 3721 to the public internet without additional protection
- Consider using HTTPS in production (reverse proxy with nginx/caddy)

## 🧪 Testing

```bash
# Health check
curl http://localhost:3721/health

# Server info
curl http://localhost:3721/

# Test MCP endpoint (requires auth)
curl -X POST \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  http://localhost:3721/mcp
```

## 🗑️ Uninstall

```bash
./uninstall.sh
```

Or manually:

```bash
sudo systemctl stop openclaw-mcp-server
sudo systemctl disable openclaw-mcp-server
sudo rm /etc/systemd/system/openclaw-mcp-server.service
rm -rf ~/.openclaw/mcp-server
```

## 📚 MCP Specification

This server implements the [Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#streamable-http) from the Model Context Protocol specification.

## 🤝 Contributing

Pull requests welcome! Please open an issue first to discuss changes.

## 📄 License

MIT

## 🔗 Links

- [OpenClaw](https://openclaw.ai)
- [OpenClaw Docs](https://docs.openclaw.ai)
- [MCP Specification](https://modelcontextprotocol.io)
- [Claude Desktop](https://claude.ai/download)
