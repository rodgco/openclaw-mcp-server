#!/usr/bin/env node

/**
 * OpenClaw MCP Server - Streamable HTTP Transport
 * 
 * Generic MCP server that exposes OpenClaw sessions via Streamable HTTP.
 * Configurable via environment variables for reuse by others.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import { spawn } from "child_process";
import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

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

// Middleware de autenticação
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid authorization header" });
  }

  const token = authHeader.substring(7);
  
  if (token !== config.apiKey) {
    return res.status(403).json({ error: "Invalid API key" });
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
async function searchMemory(query) {
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

// Criar servidor MCP
const server = new Server(
  {
    name: `${config.botName.toLowerCase().replace(/\s+/g, '-')}-mcp-server`,
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Registrar handlers
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
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
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result;

    switch (name) {
      case "ask":
        if (!args?.message) {
          throw new Error("Missing 'message' argument");
        }
        result = await sendToOpenClaw(args.message);
        break;

      case "memory_search":
        if (!args?.query) {
          throw new Error("Missing 'query' argument");
        }
        result = await searchMemory(args.query);
        break;

      case "sessions_status":
        result = await listSessions();
        break;

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [
        {
          type: "text",
          text: result || "Success",
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

// MCP endpoint (suporta POST e GET conforme spec)
app.all("/mcp", authenticate, async (req, res) => {
  const transport = new SSEServerTransport("/mcp", res);
  await server.connect(transport);
  
  console.log(`[MCP] New connection from ${req.ip}`);
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
    tools: ["ask", "memory_search", "sessions_status"],
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
