#!/bin/bash

#
# OpenClaw MCP Server - Uninstall Script
#

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

INSTALL_DIR="${HOME}/.openclaw/mcp-server"

echo -e "${YELLOW}🗑️  Uninstalling OpenClaw MCP Server...${NC}"
echo ""

# Stop and disable service if exists
if systemctl is-active --quiet openclaw-mcp-server 2>/dev/null; then
    echo "Stopping service..."
    sudo systemctl stop openclaw-mcp-server
fi

if systemctl is-enabled --quiet openclaw-mcp-server 2>/dev/null; then
    echo "Disabling service..."
    sudo systemctl disable openclaw-mcp-server
fi

if [ -f "/etc/systemd/system/openclaw-mcp-server.service" ]; then
    echo "Removing service file..."
    sudo rm /etc/systemd/system/openclaw-mcp-server.service
    sudo systemctl daemon-reload
fi

# Remove installation directory
if [ -d "$INSTALL_DIR" ]; then
    read -p "Remove ${INSTALL_DIR}? This will delete your configuration. [y/N]: " REMOVE_DIR
    if [[ "$REMOVE_DIR" =~ ^[Yy]$ ]]; then
        rm -rf "$INSTALL_DIR"
        echo -e "${GREEN}✅ Removed ${INSTALL_DIR}${NC}"
    else
        echo -e "${YELLOW}⚠️  Keeping ${INSTALL_DIR}${NC}"
    fi
fi

echo ""
echo -e "${GREEN}✅ Uninstall complete${NC}"
echo ""
echo "Don't forget to remove the MCP server config from your Claude Desktop configuration."
