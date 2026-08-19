import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv'
import type { JsonSchemaType, JsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/types'
import {
  buyerProfileToJson,
  capabilitiesToJson,
  estimateToJson,
  fillStatsToJson,
  isCashError,
  orderToJson,
  prepareResultToJson,
  preparedStepToJson,
  preparedTxToJson,
  relayQuoteToJson,
  relayStatusToJson,
} from '@zkp2p/cash'
import type { CashClient, CashPreparedStep, PreparedTransaction } from '@zkp2p/cash'
import { cashToolManifest } from '@zkp2p/cash/tools'
import type { BuiltInCashToolName } from '@zkp2p/cash/tools'

/**
 * The only client methods this server is allowed to reach. Every signing verb
 * (`cashout`, `withdraw`, `topUp`, `executeSourceQuote`) is deliberately absent:
 * an agent host drives this server, and key custody stays on the host side.
 */
export type PreparePathCashClient = Pick<
  CashClient,
  | 'buyer'
  | 'capabilities'
  | 'estimate'
  | 'fillStats'
  | 'order'
  | 'orders'
  | 'prepare'
  | 'prepareTopUp'
  | 'prepareWithdraw'
  | 'quoteSource'
  | 'relayStatus'
>

export type CashToolResult = {
  content: [{ text: string; type: 'text' }]
  isError?: boolean
}

/** Verbs that only read protocol state, so a host can auto-approve them. */
const READ_ONLY_TOOLS = new Set<BuiltInCashToolName>([
  'cash_buyer',
  'cash_capabilities',
  'cash_estimate',
  'cash_fill_stats',
  'cash_order',
  'cash_orders',
  'cash_source_quote',
  'cash_source_status',
])

/**
 * The tool list served over MCP: the schemas shipped by `@zkp2p/cash/tools`
 * verbatim, plus approval hints. Nothing here re-derives a schema, so a Peer
 * Cash release changes this server's surface without a code change.
 */
export const cashMcpTools = cashToolManifest.tools.map((tool) => ({
  ...tool,
  annotations: {
    destructiveHint: false,
    openWorldHint: true,
    readOnlyHint: READ_ONLY_TOOLS.has(tool.name as BuiltInCashToolName),
  },
}))

/** Sent to the host at initialize so the agent learns the custody boundary. */
export const cashMcpInstructions = [
  `Peer Cash ${cashToolManifest.version}: cash Base USDC out to fiat at the live oracle market rate.`,
  'Mutating verbs (cash_cashout, cash_withdraw, cash_topup) return UNSIGNED transactions in',
  '`txs[]` plus one same-index label in `steps[]`. This server holds no key, never signs, and',
  'never broadcasts. Sign and submit `txs[]` in order with your own wallet, then poll cash_order.',
  'Amounts are base units as decimal strings; USDC has 6 decimals.',
].join(' ')

const validators = compileValidators()

/**
 * Validates a tool call against its published schema and dispatches it. Errors
 * come back as tool results rather than thrown exceptions so the agent can read
 * the remediation and retry instead of losing the turn.
 */
export async function callCashTool(
  client: PreparePathCashClient,
  name: string,
  args: unknown,
): Promise<CashToolResult> {
  const validate = validators.get(name)
  const handler = handlers[name as BuiltInCashToolName]
  if (!validate || !handler) return toolError(`Unknown Peer Cash tool "${name}".`)

  const validated = validate(args ?? {})
  if (!validated.valid) return toolError(`Invalid ${name} arguments: ${validated.errorMessage}`)

  try {
    return toolResult(await handler(client, validated.data))
  } catch (error) {
    if (isCashError(error)) return toolResult(error.toJSON(), true)
    // stdout carries the MCP protocol, so diagnostics have to go to stderr.
    console.error(`Peer Cash tool "${name}" failed`, error)
    return toolError(`Peer Cash tool "${name}" failed. See the server log for details.`)
  }
}

type ToolArgs = Record<string, unknown>
type ToolHandler = (client: PreparePathCashClient, args: ToolArgs) => Promise<unknown>

const handlers: Record<BuiltInCashToolName, ToolHandler> = {
  async cash_buyer(client, args) {
    return buyerProfileToJson(await client.buyer(args.address as string))
  },
  async cash_capabilities(client, args) {
    if (args.includeRelaySources !== true) return capabilitiesToJson(client.capabilities())
    return capabilitiesToJson(await client.capabilities({ includeRelaySources: true }))
  },
  async cash_cashout(client, args) {
    return prepareResultToJson(await client.prepare(withBigIntAmount(args)))
  },
  async cash_estimate(client, args) {
    return estimateToJson(await client.estimate(withBigIntAmount(args)))
  },
  async cash_fill_stats(client) {
    return fillStatsToJson(await client.fillStats())
  },
  async cash_order(client, args) {
    return orderToJson(await client.order(args.depositId as string))
  },
  async cash_orders(client, args) {
    const orders = await client.orders(args.owner as string, {
      inFlight: args.inFlight as boolean | undefined,
      limit: args.limit as number | undefined,
    })
    return orders.map(orderToJson)
  },
  async cash_source_quote(client, args) {
    return relayQuoteToJson(await client.quoteSource(withBigIntAmount(args)))
  },
  async cash_source_status(client, args) {
    return relayStatusToJson(await client.relayStatus(args.requestId as string))
  },
  async cash_topup(client, args) {
    const depositId = args.depositId as string
    return planToJson(await client.prepareTopUp(depositId, BigInt(args.amount as string)))
  },
  async cash_withdraw(client, args) {
    return planToJson(
      await client.prepareWithdraw(args.depositId as string, {
        amount: args.amount === undefined ? undefined : BigInt(args.amount as string),
      }),
    )
  },
}

function compileValidators() {
  const provider = new AjvJsonSchemaValidator()
  return new Map<string, JsonSchemaValidator<ToolArgs>>(
    cashToolManifest.tools.map((tool) => [
      tool.name,
      provider.getValidator<ToolArgs>(tool.inputSchema as JsonSchemaType),
    ]),
  )
}

/**
 * Bridges a validated tool payload to an SDK input. The schema already pinned
 * every field, including `additionalProperties: false`; the one remaining
 * difference is `amount`, which travels as a base-unit decimal string.
 */
function withBigIntAmount<T>(args: ToolArgs): T {
  return { ...args, amount: BigInt(args.amount as string) } as T
}

function planToJson(plan: { steps: CashPreparedStep[]; txs: PreparedTransaction[] }) {
  return { steps: plan.steps.map(preparedStepToJson), txs: plan.txs.map(preparedTxToJson) }
}

function toolResult(value: unknown, isError = false): CashToolResult {
  const text = JSON.stringify(value, null, 2)
  const result: CashToolResult = { content: [{ text, type: 'text' }] }
  if (isError) result.isError = true
  return result
}

function toolError(message: string): CashToolResult {
  return { content: [{ text: message, type: 'text' }], isError: true }
}
