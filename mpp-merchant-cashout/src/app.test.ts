import assert from 'node:assert/strict'
import test from 'node:test'

import { PeerError, usdc } from '@zkp2p/sdk'

import { createApp } from './app.js'

test('prepares one unsigned plan from confirmed MPP revenue', async () => {
  const amounts: bigint[] = []
  // The SDK's createDeposit transaction also carries its ABI and bigint args.
  const createDeposit = {
    abi: [],
    args: [usdc('10')],
    chainId: 8453,
    data: '0x' as const,
    functionName: 'createDeposit',
    to: '0x0000000000000000000000000000000000000002' as const,
    value: 0n,
  }
  const { adminApp, revenue } = createApp({
    sell: {
      async prepare(input) {
        amounts.push(input.amount)
        return {
          register: { hashedOnchainIds: [] },
          steps: [{ kind: 'createDeposit', description: 'Create the sale' }],
          txs: [createDeposit],
        }
      },
    },
    cashout: { currency: 'USD', payee: 'merchant', platform: 'revolut' },
    facilitator: 'https://facilitator.example',
    recipient: '0x0000000000000000000000000000000000000001',
    secretKey: 'test-secret-key-test-secret-key-32',
  })
  revenue.record('0xsettlement', usdc('10'))

  const response = await adminApp.request('http://localhost/cashout', {
    body: JSON.stringify({}),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })

  assert.equal(response.status, 200)
  assert.deepEqual(amounts, [usdc('10')])
  const body = await response.json()
  assert.equal(body.revenue.availableUsdc, '0')
  assert.deepEqual(body.prepared.txs, [
    { chainId: 8453, data: '0x', to: '0x0000000000000000000000000000000000000002', value: '0' },
  ])

  const duplicate = await adminApp.request('http://localhost/cashout', {
    body: JSON.stringify({}),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
  assert.equal(duplicate.status, 409)
})

test('releases revenue when the SDK rejects the payout', async () => {
  const { adminApp, revenue } = createApp({
    sell: {
      async prepare() {
        throw new PeerError({
          code: 'PAYEE_NOT_FOUND',
          message: 'Payee not found',
          remediation: 'Check the payee handle',
          retryable: false,
        })
      },
    },
    cashout: { currency: 'USD', payee: 'merchant', platform: 'venmo' },
    facilitator: 'https://facilitator.example',
    recipient: '0x0000000000000000000000000000000000000001',
    secretKey: 'test-secret-key-test-secret-key-32',
  })
  revenue.record('0xsettlement', usdc('10'))

  const response = await adminApp.request('http://localhost/cashout', {
    body: JSON.stringify({}),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })

  assert.equal(response.status, 400)
  assert.equal((await response.json()).error.code, 'PAYEE_NOT_FOUND')
  assert.equal(revenue.snapshot().available, usdc('10'))
})
