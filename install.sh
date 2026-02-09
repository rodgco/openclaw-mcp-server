#!/bin/bash

#
# OpenClaw MCP Server - Installation Script
#
# Installs and configures the MCP server for exposing OpenClaw via Streamable HTTP.
# Run this on the server where OpenClaw is running.
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🏰 OpenClaw MCP Server Installer${NC}"
echo ""

# Check for Node.js
if ! command -v node &>/dev/null; then
  echo -e "${RED}❌ Node.js is not installed. Please install Node.js 18+ first.${NC}"
  exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo -e "${RED}❌ Node.js 18+ is required. Found: $(node -v)${NC}"
  exit 1
fi

# Check for OpenClaw
if ! command -v openclaw &>/dev/null; then
  echo -e "${RED}❌ OpenClaw is not installed or not in PATH.${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Node.js $(node -v)${NC}"
echo -e "${GREEN}✓ OpenClaw found${NC}"
echo ""

# Installation directory
INSTALL_DIR="${HOME}/.openclaw/mcp-server"

echo -e "${YELLOW}📁 Installing to: ${INSTALL_DIR}${NC}"
echo ""

# Create directory
mkdir -p "$INSTALL_DIR"

# Copy files
cp package.json "$INSTALL_DIR/"
cp server-mcp.js "$INSTALL_DIR/"
cp .env.example "$INSTALL_DIR/"

# Install dependencies
echo -e "${BLUE}📦 Installing dependencies...${NC}"
cd "$INSTALL_DIR"
npm install --silent

# Generate API key if .env doesn't exist
if [ ! -f ".env" ]; then
  echo -e "${BLUE}🔑 Generating API key...${NC}"
  API_KEY=$(openssl rand -base64 32)

  # Prompt for bot name
  echo ""
  read -p "Enter your bot/assistant name [Assistant]: " BOT_NAME
  BOT_NAME=${BOT_NAME:-Assistant}

  read -p "Enter OpenClaw session label [main]: " SESSION_LABEL
  SESSION_LABEL=${SESSION_LABEL:-main}

  read -p "Enter port [3721]: " PORT
  PORT=${PORT:-3721}

  # Create .env file
  cat >.env <<EOF
# ${BOT_NAME} MCP Server Configuration
BOT_NAME="${BOT_NAME}"
OPENCLAW_SESSION_LABEL="${SESSION_LABEL}"
MCP_SERVER_API_KEY="${API_KEY}"
PORT=${PORT}
BIND_ADDRESS="0.0.0.0"
OPENCLAW_WORKSPACE="${HOME}/.openclaw/workspace"
EOF

  echo ""
  echo -e "${GREEN}✅ Configuration saved to ${INSTALL_DIR}/.env${NC}"
  echo ""
  echo -e "${YELLOW}🔑 Your API Key:${NC}"
  echo -e "${GREEN}${API_KEY}${NC}"
  echo ""
  echo -e "${RED}⚠️  Save this key! You'll need it to configure Claude Desktop.${NC}"
else
  echo -e "${YELLOW}📋 Using existing .env configuration${NC}"
  source .env
  API_KEY=$MCP_SERVER_API_KEY
fi

echo ""

# Ask about systemd service
read -p "Create systemd service for auto-start? [Y/n]: " CREATE_SERVICE
CREATE_SERVICE=${CREATE_SERVICE:-Y}

if [[ "$CREATE_SERVICE" =~ ^[Yy]$ ]]; then
  SERVICE_FILE="/etc/systemd/system/openclaw-mcp-server.service"

  # Load config
  source .env

  sudo tee "$SERVICE_FILE" >/dev/null <<EOF
[Unit]
Description=${BOT_NAME} MCP Server (OpenClaw)
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${INSTALL_DIR}/.env
ExecStart=/usr/bin/node ${INSTALL_DIR}/server-mcp.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

  sudo systemctl daemon-reload
  sudo systemctl enable openclaw-mcp-server
  sudo systemctl start openclaw-mcp-server

  echo -e "${GREEN}✅ systemd service created and started${NC}"
  echo ""
  echo "Commands:"
  echo "  sudo systemctl status openclaw-mcp-server"
  echo "  sudo systemctl restart openclaw-mcp-server"
  echo "  sudo journalctl -u openclaw-mcp-server -f"
fi

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✅ Installation complete!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo ""

# Get IP
IP=$(hostname -i | awk '{print $1}')
source .env

echo -e "${BLUE}📋 Claude Desktop Configuration:${NC}"
echo ""
echo "Add this to your claude_desktop_config.json:"
echo ""
cat <<EOF
{
  "mcpServers": {
    "${BOT_NAME,,}": {
      "transport": "streamable-http",
      "url": "http://${IP}:${PORT}/mcp",
      "headers": {
        "Authorization": "Bearer ${MCP_SERVER_API_KEY}"
      }
    }
  }
}
EOF
echo ""
echo -e "${YELLOW}Config file locations:${NC}"
echo "  macOS:   ~/Library/Application Support/Claude/claude_desktop_config.json"
echo "  Windows: %APPDATA%\\Claude\\claude_desktop_config.json"
echo "  Linux:   ~/.config/Claude/claude_desktop_config.json"
echo ""
echo -e "${BLUE}📡 Server URL: http://${IP}:${PORT}/mcp${NC}"
echo -e "${BLUE}🔑 API Key: ${MCP_SERVER_API_KEY}${NC}"
echo ""
