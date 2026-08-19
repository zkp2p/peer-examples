import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { createCashClient } from '@zkp2p/cash'
import type { CashClientOptions, RuntimeEnv } from '@zkp2p/cash'

import { callCashTool, cashMcpInstructions, cashMcpTools } from './tools.js'

const options: CashClientOptions = {
  environment: (process.env.PEER_CASH_ENVIRONMENT ?? 'production') as RuntimeEnv,
}
if (process.env.PEER_CASH_RPC_URL) options.rpcUrl = process.env.PEER_CASH_RPC_URL
if (process.env.PEER_CASH_REFERRAL_CODE) options.referralCode = process.env.PEER_CASH_REFERRAL_CODE

const client = createCashClient(options)

const server = new Server(
  { name: 'peer-cash', version: '0.1.0' },
  { capabilities: { tools: {} }, instructions: cashMcpInstructions },
)

server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: cashMcpTools }))
server.setRequestHandler(CallToolRequestSchema, (request) =>
  callCashTool(client, request.params.name, request.params.arguments),
)

await server.connect(new StdioServerTransport())

// stdout is the MCP transport, so the banner belongs on stderr.
console.error(`Peer Cash MCP server ready on stdio (${options.environment}).`)
