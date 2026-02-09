#!/usr/bin/env node

/**
 * OpenClaw MCP Server - Streamable HTTP Transport
 * 
 * Manual implementation of MCP Streamable HTTP transport.
 * The SDK's SSEServerTransport is for the old protocol.
 */

import 'dotenv/config';
import express from "express";
import { spawn } from "child_process";
import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

// Configuração via variáveis de ambiente
const config = {
  botName: process.env.BOT_NAME || "Assistant",
  sessionLabel: process.env.OPENCLAW_SESSION_LABEL || "main",
  apiKey: process.env.MCP_SERVER_API_KEY,
  port: parseInt(process.env.PORT || "3721"),
  bindAddress: process.env.BIND_ADDRESS || "0.0.0.0",
  workspace: process.env.OPENCLAW_WORKSPACE || join(homedir(), ".openclaw", "workspace"),
};

if (!config.apiKey) {
  console.error("❌ MCP_SERVER_API_KEY environment variable is required!");
  console.error("Generate one with: openssl rand -base64 32");
  console.error("Then set it in .env file or export MCP_SERVER_API_KEY=your-key");
  process.exit(1);
}

const app = express();
app.use(express.json());

// Session storage
const sessions = new Map();

// Server info
const SERVER_INFO = {
  name: `${config.botName.toLowerCase().replace(/\s+/g, '-')}-mcp-server`,
  version: "1.0.0",
};

const SERVER_CAPABILITIES = {
  tools: {},
};

const TOOLS = [
  {
    name: "ask",
    description: `Enviar uma pergunta ou mensagem para ${config.botName}. Use quando precisar consultar informações, contexto, ou delegar tarefas específicas.`,
    inputSchema: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: `A mensagem ou pergunta para enviar a ${config.botName}`,
        },
      },
      required: ["message"],
    },
  },
  {
    name: "memory_search",
    description: `Buscar na memória de longo prazo de ${config.botName} (MEMORY.md). Útil para encontrar decisões passadas, contexto de projetos, etc.`,
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Termo ou frase para buscar na memória",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "sessions_status",
    description: "Verificar status das sessões do OpenClaw",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

// Middleware de autenticação
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ 
      jsonrpc: "2.0",
      error: { code: -32600, message: "Missing or invalid authorization header" },
      id: null 
    });
  }

  const token = authHeader.substring(7);
  
  if (token !== config.apiKey) {
    return res.status(403).json({ 
      jsonrpc: "2.0",
      error: { code: -32600, message: "Invalid API key" },
      id: null 
    });
  }

  next();
}

/**
 * Envia mensagem para o OpenClaw
 */
async function sendToOpenClaw(message, timeout = 120) {
  return new Promise((resolve, reject) => {
    const escapedMessage = message.replace(/"/g, '\\"');
    
    const proc = spawn('openclaw', [
      'sessions',
      'send',
      '--label', config.sessionLabel,
      '--message', escapedMessage,
      '--timeout', timeout.toString()
    ]);

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => stdout += data.toString());
    proc.stderr.on('data', (data) => stderr += data.toString());

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`OpenClaw exited with code ${code}: ${stderr}`));
      } else {
        resolve(stdout.trim());
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn openclaw: ${err.message}`));
    });
  });
}

/**
 * Busca na memória do assistente (MEMORY.md)
 */
function searchMemory(query) {
  const memoryPath = join(config.workspace, "MEMORY.md");

  if (!existsSync(memoryPath)) {
    return "MEMORY.md não encontrado no workspace";
  }

  const memoryContent = readFileSync(memoryPath, "utf-8");
  const lines = memoryContent.split("\n");
  const matches = lines.filter(line => 
    line.toLowerCase().includes(query.toLowerCase())
  );

  if (matches.length === 0) {
    return `Nenhum resultado encontrado para "${query}" na memória.`;
  }

  return `Encontrados ${matches.length} resultados:\n\n${matches.slice(0, 10).join("\n")}`;
}

/**
 * Lista sessões ativas
 */
async function listSessions() {
  return new Promise((resolve, reject) => {
    const proc = spawn('openclaw', ['sessions', 'list', '--limit', '10']);
    
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => stdout += data.toString());
    proc.stderr.on('data', (data) => stderr += data.toString());

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`OpenClaw exited with code ${code}: ${stderr}`));
      } else {
        resolve(stdout.trim());
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn openclaw: ${err.message}`));
    });
  });
}

/**
 * Handle JSON-RPC request
 */
async function handleRequest(method, params, id) {
  console.log(`[MCP] Handling method: ${method}`);
  
  switch (method) {
    case "initialize":
      const sessionId = randomUUID();
      sessions.set(sessionId, { 
        initialized: true, 
        protocolVersion: params.protocolVersion,
        clientInfo: params.clientInfo 
      });
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: SERVER_CAPABILITIES,
          serverInfo: SERVER_INFO,
          sessionId,
        },
      };

    case "initialized":
      // Client acknowledges initialization
      return null; // No response needed for notification

    case "tools/list":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: TOOLS,
        },
      };

    case "tools/call":
      const toolName = params.name;
      const toolArgs = params.arguments || {};
      console.log(`[MCP] Calling tool: ${toolName}`, toolArgs);
      
      try {
        let result;
        
        switch (toolName) {
          case "ask":
            if (!toolArgs.message) {
              throw new Error("Missing 'message' argument");
            }
            console.log(`[MCP] Sending to OpenClaw: ${toolArgs.message}`);
            result = await sendToOpenClaw(toolArgs.message);
            console.log(`[MCP] OpenClaw response received`);
            break;

          case "memory_search":
            if (!toolArgs.query) {
              throw new Error("Missing 'query' argument");
            }
            result = searchMemory(toolArgs.query);
            break;

          case "sessions_status":
            result = await listSessions();
            break;

          default:
            throw new Error(`Unknown tool: ${toolName}`);
        }

        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: result || "Success",
              },
            ],
          },
        };
      } catch (error) {
        console.error(`[MCP] Tool error:`, error);
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: `Error: ${error.message}`,
              },
            ],
            isError: true,
          },
        };
      }

    case "ping":
      return {
        jsonrpc: "2.0",
        id,
        result: {},
      };

    default:
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32601,
          message: `Method not found: ${method}`,
        },
      };
  }
}

// MCP endpoint - POST for requests
app.post("/mcp", authenticate, async (req, res) => {
  const { method, params, id, jsonrpc } = req.body;
  
  console.log(`[MCP] POST request - method: ${method}, id: ${id}`);
  
  if (jsonrpc !== "2.0") {
    return res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32600, message: "Invalid JSON-RPC version" },
      id: null,
    });
  }

  try {
    const response = await handleRequest(method, params || {}, id);
    
    if (response === null) {
      // Notification - no response
      res.status(202).end();
    } else {
      res.json(response);
    }
  } catch (error) {
    console.error(`[MCP] Error:`, error);
    res.status(500).json({
      jsonrpc: "2.0",
      error: { code: -32603, message: error.message },
      id,
    });
  }
});

// MCP endpoint - GET for SSE stream (optional, for server-initiated messages)
app.get("/mcp", authenticate, (req, res) => {
  console.log(`[MCP] GET request - SSE stream`);
  
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Keep connection alive
  const keepAlive = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 30000);

  req.on('close', () => {
    console.log(`[MCP] SSE stream closed`);
    clearInterval(keepAlive);
  });
});

// Health check
app.get("/health", (req, res) => {
  res.json({ 
    status: "ok", 
    botName: config.botName,
    timestamp: new Date().toISOString() 
  });
});

// Info endpoint (sem autenticação)
app.get("/", (req, res) => {
  res.json({
    name: `${config.botName} MCP Server`,
    version: "1.0.0",
    transport: "streamable-http",
    endpoint: "/mcp",
    authentication: "Bearer token required",
    tools: TOOLS.map(t => t.name),
  });
});

// Iniciar servidor
app.listen(config.port, config.bindAddress, () => {
  console.log(`🏰 ${config.botName} MCP Server (Streamable HTTP)`);
  console.log(`🌐 Listening on http://${config.bindAddress}:${config.port}`);
  console.log(`📡 MCP endpoint: /mcp`);
  console.log(`🔑 API Key authentication enabled`);
  console.log(`📋 Session label: ${config.sessionLabel}`);
  console.log(`📂 Workspace: ${config.workspace}`);
  console.log(`✅ Ready to receive MCP connections`);
});
