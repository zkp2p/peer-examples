import { createPeer, formatUsdc, isPeerError, usdc } from '@zkp2p/sdk'
import type { CurrencyType, PeerSell } from '@zkp2p/sdk'
import { Hono } from 'hono'
import { Mppx, evm } from 'mppx/server'
import type { Facilitator } from 'mppx/x402'

import { RevenueTracker } from './revenue.js'

export type AppOptions = {
  sell?: Pick<PeerSell, 'prepare'> | undefined
  cashout: {
    currency: CurrencyType
    payee: string
    platform: string
    thresholdUsdc?: string | undefined
  }
  facilitator: string | Facilitator
  recipient: `0x${string}`
  secretKey: string
}

/** Creates an MPP merchant API and a localhost-only Peer cash-out planner. */
export function createApp(options: AppOptions) {
  const sell = options.sell ?? createPeer({ environment: 'production' }).sell
  const revenue = new RevenueTracker(usdc(options.cashout.thresholdUsdc ?? '10'))

  const payments = Mppx.create({
    methods: [
      evm.charge({
        currency: evm.assets.base.USDC,
        onPaymentSuccess: ({ receipt, request }) => {
          const recorded = revenue.record(receipt.reference, BigInt(request.amount))
          if (recorded) {
            console.log(
              `MPP payment settled: ${formatUsdc(BigInt(request.amount))} USDC (${receipt.reference})`,
            )
          }
        },
        recipient: options.recipient,
        x402: { facilitator: options.facilitator },
      }),
    ],
    secretKey: options.secretKey,
  })

  const publicApp = new Hono()
  publicApp.get('/api/health', (c) => c.json({ status: 'ok' }))
  publicApp.get('/api/report', async (c) => {
    const result = await payments.evm.charge({
      amount: '0.01',
      description: 'Merchant report',
    })(c.req.raw)
    if (result.status === 402) return result.challenge
    return result.withReceipt(c.json({ report: 'paid MPP resource' }))
  })

  const adminApp = new Hono()
  adminApp.get('/status', (c) => c.json(formatSnapshot(revenue)))
  adminApp.post('/cashout', async (c) => {
    let amount = 0n
    let reserved = false
    try {
      const body = await readCashoutBody(c.req.raw)
      const snapshot = revenue.snapshot()
      if (!snapshot.ready) {
        return c.json(
          {
            error: 'confirmed MPP settlements have not reached the cash-out threshold',
            ...formatSnapshot(revenue),
          },
          409,
        )
      }

      amount = body.amountUsdc === undefined ? snapshot.available : usdc(body.amountUsdc)
      if (amount <= 0n) return c.json({ error: 'cash-out amount must be positive' }, 400)
      if (amount > snapshot.available) {
        return c.json(
          {
            error: 'cash-out amount exceeds confirmed, unreserved MPP settlements',
            ...formatSnapshot(revenue),
          },
          409,
        )
      }
      revenue.reserve(amount)
      reserved = true

      const prepared = await sell.prepare({
        amount,
        receive: {
          currency: options.cashout.currency,
          payee: options.cashout.payee,
          platform: options.cashout.platform,
        },
      })

      return c.json({
        amountUsdc: formatUsdc(amount),
        note: 'Unsigned only. Persist settlement, reservation, and confirmed cash-out state in production.',
        prepared: {
          ...prepared,
          txs: prepared.txs.map((tx) => ({ ...tx, value: tx.value.toString() })),
        },
        revenue: formatSnapshot(revenue),
      })
    } catch (error) {
      if (reserved) revenue.release(amount)
      if (isPeerError(error)) return c.json({ error: error.toJSON() }, 400)
      if (error instanceof CashoutRequestError) return c.json({ error: error.message }, 400)
      console.error('Unable to prepare Peer cash-out', error)
      return c.json({ error: 'Unable to prepare Peer cash-out' }, 500)
    }
  })

  return { adminApp, publicApp, revenue }
}

function formatSnapshot(revenue: RevenueTracker) {
  const snapshot = revenue.snapshot()
  return {
    availableUsdc: formatUsdc(snapshot.available),
    ready: snapshot.ready,
    reservedUsdc: formatUsdc(snapshot.reserved),
    settledUsdc: formatUsdc(snapshot.settled),
    thresholdUsdc: formatUsdc(snapshot.threshold),
  }
}

async function readCashoutBody(request: Request): Promise<{ amountUsdc?: string | undefined }> {
  let body: { amountUsdc?: unknown }
  try {
    body = (await request.json()) as { amountUsdc?: unknown }
  } catch {
    throw new CashoutRequestError('Request body must be JSON.')
  }
  if (body.amountUsdc === undefined) return {}
  if (typeof body.amountUsdc !== 'string' || !/^\d+(\.\d{1,6})?$/.test(body.amountUsdc)) {
    throw new CashoutRequestError(
      'amountUsdc must be a positive decimal string with at most six decimals.',
    )
  }
  return { amountUsdc: body.amountUsdc }
}

class CashoutRequestError extends Error {}
