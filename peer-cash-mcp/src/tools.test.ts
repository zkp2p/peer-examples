import assert from 'node:assert/strict'
import test from 'node:test'

import { errors } from '@zkp2p/cash'
import { cashToolManifest } from '@zkp2p/cash/tools'

import { callCashTool } from './tools.js'
import type { PreparePathCashClient } from './tools.js'
import { cashMcpTools } from './tools.js'

const ADDRESS = '0x0000000000000000000000000000000000000001'
const DEPOSIT_ID = `${ADDRESS}_7`

/** One valid call per published verb, and the client method it must reach. */
const ROUTES = {
  cash_buyer: { args: { address: ADDRESS }, method: 'buyer' },
  cash_capabilities: { args: {}, method: 'capabilities' },
  cash_cashout: {
    args: { amount: '25000000', receive: { currency: 'USD', payee: '@peer', platform: 'venmo' } },
    method: 'prepare',
  },
  cash_estimate: { args: { amount: '25000000', currency: 'USD' }, method: 'estimate' },
  cash_fill_stats: { args: {}, method: 'fillStats' },
  cash_order: { args: { depositId: DEPOSIT_ID }, method: 'order' },
  cash_orders: { args: { owner: ADDRESS }, method: 'orders' },
  cash_source_quote: {
    args: { amount: '1000000', source: { chainId: 42161, currency: ADDRESS }, user: ADDRESS },
    method: 'quoteSource',
  },
  cash_source_status: { args: { requestId: 'req_1' }, method: 'relayStatus' },
  cash_topup: { args: { amount: '5000000', depositId: DEPOSIT_ID }, method: 'prepareTopUp' },
  cash_withdraw: { args: { depositId: DEPOSIT_ID }, method: 'prepareWithdraw' },
}

test('serves the published Peer Cash schemas instead of re-deriving them', () => {
  assert.deepEqual(
    cashMcpTools.map((tool) => tool.name),
    cashToolManifest.tools.map((tool) => tool.name),
  )
  for (const tool of cashMcpTools) {
    const published = cashToolManifest.tools.find((candidate) => candidate.name === tool.name)
    assert.equal(tool.inputSchema, published?.inputSchema)
    assert.equal(tool.description, published?.description)
  }
})

test('marks only the observer verbs read-only', () => {
  const mutating = cashMcpTools.filter((tool) => !tool.annotations.readOnlyHint)
  assert.deepEqual(
    mutating.map((tool) => tool.name),
    ['cash_cashout', 'cash_withdraw', 'cash_topup'],
  )
  assert.ok(cashMcpTools.every((tool) => tool.annotations.destructiveHint === false))
})

test('routes every published verb to a prepare-path client method', async () => {
  for (const [name, route] of Object.entries(ROUTES)) {
    const touched: string[] = []
    const client = new Proxy(
      {},
      {
        get(_target, property) {
          touched.push(String(property))
          return () => undefined
        },
      },
    ) as PreparePathCashClient

    await withSilentErrors(() => callCashTool(client, name, route.args))
    assert.deepEqual(touched, [route.method], `${name} reached the wrong client method`)
  }
})

test('prepares an unsigned cash-out from base-unit string amounts', async () => {
  const calls: unknown[] = []
  const client = {
    async prepare(input: unknown) {
      calls.push(input)
      return {
        accessPolicyRequired: false,
        register: { hashedOnchainIds: ['0xhash'] },
        steps: [{ description: 'Approve USDC', kind: 'approve' as const }],
        txs: [{ data: '0x', to: ADDRESS, value: 0n }],
      }
    },
  } as unknown as PreparePathCashClient

  const result = await callCashTool(client, 'cash_cashout', ROUTES.cash_cashout.args)

  assert.equal(result.isError, undefined)
  assert.deepEqual(calls, [
    { amount: 25_000_000n, receive: { currency: 'USD', payee: '@peer', platform: 'venmo' } },
  ])
  const payload = JSON.parse(result.content[0].text)
  assert.equal(payload.txs[0].value, '0')
  assert.deepEqual(payload.steps[0], { description: 'Approve USDC', kind: 'approve' })
  assert.equal(payload.accessPolicyRequired, false)
})

test('closes an order without an amount and tops one up with one', async () => {
  const calls: unknown[][] = []
  const plan = { steps: [], txs: [] }
  const client = {
    async prepareTopUp(depositId: string, amount: bigint) {
      calls.push([depositId, amount])
      return plan
    },
    async prepareWithdraw(depositId: string, opts?: { amount?: bigint }) {
      calls.push([depositId, opts?.amount])
      return plan
    },
  } as unknown as PreparePathCashClient

  await callCashTool(client, 'cash_withdraw', ROUTES.cash_withdraw.args)
  await callCashTool(client, 'cash_withdraw', { amount: '1000000', depositId: DEPOSIT_ID })
  await callCashTool(client, 'cash_topup', ROUTES.cash_topup.args)

  assert.deepEqual(calls, [
    [DEPOSIT_ID, undefined],
    [DEPOSIT_ID, 1_000_000n],
    [DEPOSIT_ID, 5_000_000n],
  ])
})

test('rejects arguments the published schema does not allow', async () => {
  const client = new Proxy(
    {},
    {
      get(_target, property) {
        throw new Error(`client.${String(property)} must not run on invalid arguments`)
      },
    },
  ) as PreparePathCashClient

  const badId = await callCashTool(client, 'cash_order', { depositId: 'not-a-deposit' })
  assert.equal(badId.isError, true)
  assert.match(badId.content[0].text, /depositId must match pattern/)

  const extra = await callCashTool(client, 'cash_order', { depositId: DEPOSIT_ID, sign: true })
  assert.match(extra.content[0].text, /must NOT have additional properties/)

  const bothCurrencies = await callCashTool(client, 'cash_cashout', {
    amount: '25000000',
    receive: { currencies: ['USD'], currency: 'USD', payee: '@peer', platform: 'venmo' },
  })
  assert.equal(bothCurrencies.isError, true)

  const unknown = await callCashTool(client, 'cash_teleport', {})
  assert.equal(unknown.isError, true)
  assert.match(unknown.content[0].text, /Unknown Peer Cash tool/)
})

test('hands typed Peer Cash errors back to the agent with their remediation', async () => {
  const client = {
    async prepareWithdraw() {
      throw errors.activeIntentBlocksWithdrawal(DEPOSIT_ID)
    },
  } as unknown as PreparePathCashClient

  const result = await callCashTool(client, 'cash_withdraw', ROUTES.cash_withdraw.args)

  assert.equal(result.isError, true)
  const payload = JSON.parse(result.content[0].text)
  assert.equal(payload.code, 'ACTIVE_INTENT_BLOCKS_WITHDRAWAL')
  assert.equal(payload.retryable, true)
  assert.ok(payload.remediation)
})

/** Handler failures are logged; the tests assert the result, not the log. */
async function withSilentErrors<T>(run: () => Promise<T>): Promise<T> {
  const original = console.error
  console.error = () => {}
  try {
    return await run()
  } finally {
    console.error = original
  }
}
