import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createCashClient,
  formatUsdc,
  isCashError,
  usdc,
  type CashAsset,
  type CashCapabilities,
  type CashEstimate,
  type CashFillEta,
  type CashChain,
  type CashOrder,
  type CashPlatformCapability,
  type CurrencyType,
  type RelaySourceInput,
} from '@zkp2p/cash';
import {
  createWalletClient,
  custom,
  formatUnits,
  parseUnits,
  type Address,
  type Hash,
  type WalletClient,
} from 'viem';
import { base } from 'viem/chains';
import './styles.css';

const BASE_CHAIN_HEX = '0x2105';
const BASE_CHAIN_ID = 8453;
const ESTIMATE_CACHE_TTL_MS = 30_000;
const cash = createCashClient({ environment: 'production', referrer: 'peer-cash-demo' });
const baseCapabilities = cash.capabilities();

type BusyState = 'connect' | 'estimate' | 'cashout' | 'refresh' | 'withdraw' | null;
type SourceAsset = CashAsset & { chainId: number };
type SourceChainOption = Pick<CashChain, 'id' | 'name' | 'displayName'> & {
  tokens: SourceAsset[];
};
type EstimateCacheEntry = {
  createdAt: number;
  estimate?: CashEstimate;
  promise?: Promise<CashEstimate>;
};

type Notice =
  | { kind: 'neutral'; text: string }
  | { kind: 'success'; text: string }
  | { kind: 'warning'; text: string }
  | { kind: 'error'; text: string };

function hasCode(value: unknown): value is { code: number } {
  return typeof value === 'object' && value != null && 'code' in value;
}

function shortAddress(value: string): string {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function sourceKey(chainId: number, currency: string): string {
  return `${chainId}:${currency.toLowerCase()}`;
}

function defaultSourceKey(capabilities: CashCapabilities): string {
  return sourceKey(capabilities.source.default.chainId, capabilities.source.default.token.address);
}

function defaultSourceAsset(capabilities: CashCapabilities): SourceAsset {
  return {
    chainId: capabilities.source.default.chainId,
    address: capabilities.source.default.token.address,
    symbol: capabilities.source.default.token.symbol,
    decimals: capabilities.source.default.token.decimals,
    name: capabilities.source.default.token.symbol,
  };
}

function formatTokenAmount(amount: bigint, decimals: number, symbol: string): string {
  const formatted = formatUnits(amount, decimals);
  const [whole, decimal] = formatted.split('.');
  const trimmed = decimal?.slice(0, 4).replace(/0+$/, '') ?? '';
  return `${whole}${trimmed ? `.${trimmed}` : ''} ${symbol}`;
}

function formatNumber(value: number | undefined, currency?: string): string {
  if (value === undefined || Number.isNaN(value)) return '-';
  return `${new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(value)}${currency ? ` ${currency}` : ''}`;
}

function normalizePayee(platform: string, value: string): string {
  const trimmed = value.trim();
  if (platform === 'venmo' && trimmed && !trimmed.startsWith('@')) return `@${trimmed}`;
  return trimmed;
}

function normalizeSourceAsset(asset: CashAsset, fallbackChainId: number): SourceAsset {
  return { ...asset, chainId: asset.chainId ?? fallbackChainId };
}

function tokenLabel(asset: SourceAsset): string {
  const name = asset.name && asset.name !== asset.symbol ? ` · ${asset.name}` : '';
  return `${asset.symbol}${name}`;
}

function buildSourceChains(capabilities: CashCapabilities): SourceChainOption[] {
  const defaultAsset = defaultSourceAsset(capabilities);
  const defaultKey = sourceKey(defaultAsset.chainId, defaultAsset.address);
  const chains = new Map<number, SourceChainOption>();

  chains.set(defaultAsset.chainId, {
    id: defaultAsset.chainId,
    name: 'Base',
    displayName: 'Base',
    tokens: [defaultAsset],
  });

  for (const chain of capabilities.source.relay?.chains ?? []) {
    if (chain.disabled || !chain.depositEnabled || chain.blockProductionLagging) continue;

    const existing = chains.get(chain.id);
    const next: SourceChainOption = existing ?? {
      id: chain.id,
      name: chain.name,
      displayName: chain.displayName || chain.name,
      tokens: [],
    };
    const known = new Set(next.tokens.map((token) => sourceKey(chain.id, token.address)));

    for (const token of chain.tokens) {
      const normalized = normalizeSourceAsset(token, chain.id);
      const key = sourceKey(chain.id, normalized.address);
      if (!known.has(key)) {
        next.tokens.push(normalized);
        known.add(key);
      }
    }

    next.tokens.sort((a, b) => {
      const aKey = sourceKey(chain.id, a.address);
      const bKey = sourceKey(chain.id, b.address);
      if (aKey === defaultKey) return -1;
      if (bKey === defaultKey) return 1;
      return a.symbol.localeCompare(b.symbol);
    });
    chains.set(chain.id, next);
  }

  return [...chains.values()].sort((a, b) => {
    if (a.id === BASE_CHAIN_ID) return -1;
    if (b.id === BASE_CHAIN_ID) return 1;
    return a.displayName.localeCompare(b.displayName);
  });
}

function relayProgressText(value: unknown): string {
  if (typeof value !== 'object' || value == null) return 'Relay source route in progress.';
  const record = value as Record<string, unknown>;
  const status = record.status ?? record.currentStep ?? record.step;
  return status ? `Relay source route: ${String(status)}.` : 'Relay source route in progress.';
}

async function switchToBase(provider: NonNullable<Window['ethereum']>) {
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: BASE_CHAIN_HEX }],
    });
  } catch (err) {
    if (hasCode(err) && err.code === 4902) {
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: BASE_CHAIN_HEX,
            chainName: 'Base',
            nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
            rpcUrls: ['https://mainnet.base.org'],
            blockExplorerUrls: ['https://basescan.org'],
          },
        ],
      });
      return;
    }
    throw err;
  }
}

async function connectWallet(): Promise<{ account: Address; signer: WalletClient }> {
  const provider = window.ethereum;
  if (!provider) throw new Error('No injected wallet found. Open this app in a browser wallet.');

  const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
  const account = accounts[0] as Address | undefined;
  if (!account) throw new Error('Wallet connection returned no account.');

  await switchToBase(provider);
  return {
    account,
    signer: createWalletClient({
      account,
      chain: base,
      transport: custom(provider),
    }),
  };
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string | undefined;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

function StatusPill({ order }: { order: CashOrder | null }) {
  const label = order?.state ?? 'not started';
  return <span className={`status-pill status-${label}`}>{label}</span>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function formatUsdcShort(amount: bigint): string {
  const formatted = formatUsdc(amount);
  const [whole, decimal] = formatted.split('.');
  if (!decimal) return `${formatted} USDC`;
  const trimmed = decimal.slice(0, 4).replace(/0+$/, '');
  return `${whole}${trimmed ? `.${trimmed}` : ''} USDC`;
}

function formatEta(eta: CashFillEta | undefined): string {
  if (!eta) return 'Run estimate';
  if (eta.seconds === undefined) {
    return eta.label
      .replace(/^usually starts\s+/i, '')
      .replace(/^in\s+/i, '')
      .replace(/^about\s+/i, '');
  }

  if (eta.seconds < 60) return '<1 min';

  const minutes = Math.max(1, Math.round(eta.seconds / 60));
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hr`;

  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

function estimateCacheKey(input: {
  amount: bigint;
  currency: CurrencyType;
  platform: string;
  source?: RelaySourceInput & { user: string; recipient: string };
}): string {
  return JSON.stringify({
    amount: input.amount.toString(),
    currency: input.currency,
    platform: input.platform,
    source: input.source
      ? {
          chainId: input.source.chainId,
          currency: input.source.currency.toLowerCase(),
          user: input.source.user.toLowerCase(),
          recipient: input.source.recipient.toLowerCase(),
        }
      : null,
  });
}

function App() {
  const estimateCacheRef = useRef(new Map<string, EstimateCacheEntry>());
  const [capabilities, setCapabilities] = useState<CashCapabilities>(baseCapabilities);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceLoadFailed, setSourceLoadFailed] = useState(false);
  const defaultPlatform = capabilities.platforms.find(
    (item) => item.platform === 'venmo' && !item.requiresIdentityAttestation,
  );
  const [platform, setPlatform] = useState(
    defaultPlatform?.platform ?? capabilities.platforms[0]!.platform,
  );
  const selectedPlatform = capabilities.platforms.find((item) => item.platform === platform) as
    CashPlatformCapability | undefined;
  const currencies = selectedPlatform?.currencies ?? [];
  const [currency, setCurrency] = useState<CurrencyType>((currencies[0] ?? 'USD') as CurrencyType);

  const [amount, setAmount] = useState('1');
  const [payee, setPayee] = useState('@your-venmo');
  const [orders, setOrders] = useState<CashOrder[]>([]);
  const [selectedDepositId, setSelectedDepositId] = useState('');
  const [account, setAccount] = useState<Address | null>(null);
  const [signer, setSigner] = useState<WalletClient | null>(null);
  const [sourceChainId, setSourceChainId] = useState(
    String(baseCapabilities.source.default.chainId),
  );
  const [sourceAssetKey, setSourceAssetKey] = useState(defaultSourceKey(baseCapabilities));
  const [estimate, setEstimate] = useState<CashEstimate | null>(null);
  const [order, setOrder] = useState<CashOrder | null>(null);
  const [notice, setNotice] = useState<Notice>({
    kind: 'neutral',
    text: '',
  });
  const [busy, setBusy] = useState<BusyState>(null);
  const [lastTx, setLastTx] = useState<Hash | null>(null);

  const sourceChains = useMemo(() => buildSourceChains(capabilities), [capabilities]);
  const selectedSourceChain =
    sourceChains.find((chain) => chain.id === Number(sourceChainId)) ?? sourceChains[0];
  const selectedSourceAsset =
    selectedSourceChain?.tokens.find(
      (asset) => sourceKey(selectedSourceChain.id, asset.address) === sourceAssetKey,
    ) ?? selectedSourceChain?.tokens[0];
  const isDefaultSource =
    selectedSourceAsset != null &&
    sourceKey(selectedSourceAsset.chainId, selectedSourceAsset.address) ===
      defaultSourceKey(capabilities);
  const sourceSummary =
    selectedSourceChain && selectedSourceAsset
      ? `${selectedSourceAsset.symbol} on ${selectedSourceChain.displayName}`
      : 'Base USDC';

  const availablePlatforms = useMemo(
    () => capabilities.platforms.filter((item) => !item.requiresIdentityAttestation),
    [capabilities.platforms],
  );

  useEffect(() => {
    let cancelled = false;
    setSourceLoading(true);

    cash
      .capabilities({ includeRelaySources: true })
      .then((next) => {
        if (!cancelled) {
          setCapabilities(next);
          setSourceLoadFailed(false);
        }
      })
      .catch(() => {
        if (!cancelled) setSourceLoadFailed(true);
      })
      .finally(() => {
        if (!cancelled) setSourceLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedSourceChain) return;
    if (!selectedSourceAsset) {
      const first = selectedSourceChain.tokens[0];
      if (first) setSourceAssetKey(sourceKey(selectedSourceChain.id, first.address));
    }
  }, [selectedSourceAsset, selectedSourceChain]);

  useEffect(() => {
    const nextPlatform = capabilities.platforms.find((item) => item.platform === platform);
    if (!nextPlatform) {
      setPlatform(availablePlatforms[0]?.platform ?? capabilities.platforms[0]!.platform);
      return;
    }
    if (!nextPlatform.currencies.includes(currency)) {
      setCurrency(nextPlatform.currencies[0] as CurrencyType);
    }
  }, [availablePlatforms, currency, platform]);

  useEffect(() => {
    if (!account) {
      setOrders([]);
      setSelectedDepositId('');
      setOrder(null);
      return;
    }
    const owner = account;
    let cancelled = false;
    let timer: number | undefined;

    async function poll() {
      try {
        const walletOrders = await cash.orders(owner);
        if (cancelled) return;
        setOrders(walletOrders);

        const nextDepositId =
          walletOrders.find((item) => item.depositId === selectedDepositId)?.depositId ??
          walletOrders[0]?.depositId ??
          '';
        setSelectedDepositId(nextDepositId);

        if (!nextDepositId) {
          setOrder(null);
          setNotice({ kind: 'neutral', text: '' });
          return;
        }

        const next = await cash.order(nextDepositId);
        if (!cancelled) {
          setOrder(next);
          setNotice({ kind: 'neutral', text: next.explain() });
        }
      } catch (err) {
        if (isCashError(err) && err.retryable) {
          if (!cancelled) setNotice({ kind: 'warning', text: err.remediation });
        } else if (!cancelled) {
          setNotice({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
        }
      } finally {
        if (!cancelled) timer = window.setTimeout(poll, 5_000);
      }
    }

    void poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [account, selectedDepositId]);

  async function run<T>(state: BusyState, action: () => Promise<T>): Promise<T | null> {
    setBusy(state);
    setNotice({ kind: 'neutral', text: 'Working.' });
    try {
      return await action();
    } catch (err) {
      if (isCashError(err)) {
        setNotice({ kind: err.retryable ? 'warning' : 'error', text: err.remediation });
      } else {
        setNotice({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
      }
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function handleConnect() {
    await run('connect', async () => {
      const connected = await connectWallet();
      setAccount(connected.account);
      setSigner(connected.signer);
      await loadWalletOrders(connected.account, selectedDepositId);
      setNotice({ kind: 'success', text: `Connected ${shortAddress(connected.account)} on Base.` });
    });
  }

  async function ensureWallet(): Promise<{ account: Address; signer: WalletClient }> {
    if (account && signer) return { account, signer };
    const connected = await connectWallet();
    setAccount(connected.account);
    setSigner(connected.signer);
    return connected;
  }

  async function loadWalletOrders(owner: Address, preferredDepositId?: string) {
    const walletOrders = await cash.orders(owner);
    setOrders(walletOrders);

    const nextDepositId =
      walletOrders.find((item) => item.depositId === preferredDepositId)?.depositId ??
      walletOrders[0]?.depositId ??
      '';
    setSelectedDepositId(nextDepositId);

    if (!nextDepositId) {
      setOrder(null);
      setNotice({ kind: 'neutral', text: '' });
      return;
    }

    const next = await cash.order(nextDepositId);
    setOrder(next);
    setNotice({ kind: 'neutral', text: next.explain() });
  }

  async function handleEstimate() {
    await run('estimate', async () => {
      const source = selectedRelaySource();
      const owner = source ? (account ?? (await ensureWallet()).account) : account;
      const estimateInput = {
        amount: parseCashAmount(),
        currency,
        platform,
        ...(source && owner
          ? { source: { ...source, user: owner, recipient: owner } }
          : {}),
      };
      const cacheKey = estimateCacheKey(estimateInput);
      const now = Date.now();
      const cached = estimateCacheRef.current.get(cacheKey);
      let next: CashEstimate;

      if (cached && now - cached.createdAt < ESTIMATE_CACHE_TTL_MS) {
        next = cached.estimate ?? (await cached.promise!);
      } else {
        const promise = cash.estimate(estimateInput);
        estimateCacheRef.current.set(cacheKey, { createdAt: now, promise });
        next = await promise;
        estimateCacheRef.current.set(cacheKey, { createdAt: Date.now(), estimate: next });
      }

      setEstimate(next);
      // The Oracle estimate strip already shows the amount; only surface a
      // notice when the oracle read is stale, which is genuinely new signal.
      setNotice(
        next.stale
          ? { kind: 'warning', text: 'Oracle rate may be stale. Estimate again for a fresh read.' }
          : { kind: 'neutral', text: '' },
      );
    });
  }

  async function handleCashout() {
    const wallet = await ensureWallet();

    await run('cashout', async () => {
      if (!selectedPlatform) throw new Error('Select a payout platform.');
      if (selectedPlatform.requiresIdentityAttestation) {
        throw new Error(`${selectedPlatform.platform} requires the ZKP2P app first.`);
      }
      const source = selectedRelaySource();
      const result = await cash.cashout(
        {
          amount: parseCashAmount(),
          ...(source ? { source: { ...source, recipient: wallet.account } } : {}),
          receive: {
            platform,
            currency,
            payee: { offchainId: normalizePayee(platform, payee) },
          },
        },
        {
          signer: wallet.signer,
          ...(source && source.chainId !== BASE_CHAIN_ID
            ? {
                sourceSigner: createWalletClient({
                  account: wallet.account,
                  transport: custom(window.ethereum!),
                }),
              }
            : {}),
          ...(source
            ? {
                onSourceProgress: (data) => {
                  setNotice({ kind: 'neutral', text: relayProgressText(data) });
                },
              }
            : {}),
        },
      );
      setSelectedDepositId(result.depositId);
      setOrder(result.order);
      setLastTx(result.txHash);
      await loadWalletOrders(wallet.account, result.depositId);
      setNotice({
        kind: 'success',
        text: result.source
          ? `Cash-out created. Relay delivered ${formatUsdcShort(result.source.amount)}.`
          : 'Cash-out created.',
      });
    });
  }

  async function handleRefresh() {
    await run('refresh', async () => {
      const wallet = account ? { account } : await ensureWallet();
      await loadWalletOrders(wallet.account, selectedDepositId);
    });
  }

  async function handleWithdraw() {
    if (!selectedDepositId) return;
    const wallet = await ensureWallet();

    await run('withdraw', async () => {
      const result = await cash.withdraw(selectedDepositId, { signer: wallet.signer });
      setLastTx(result.withdrawTxHash);
      await loadWalletOrders(wallet.account, selectedDepositId);
      setNotice({ kind: 'success', text: 'Withdraw submitted.' });
    });
  }

  const canCashout =
    amount.trim() !== '' &&
    payee.trim() !== '' &&
    selectedPlatform != null &&
    selectedSourceAsset != null &&
    !selectedPlatform.requiresIdentityAttestation &&
    busy == null;
  const canWithdraw = Boolean(order?.nextActions.includes('withdraw')) && busy == null;
  const filledCount = order?.fills.filter((fill) => fill.fulfilledAt !== undefined).length ?? 0;
  const visibleFills = order?.fills.slice(0, 3) ?? [];
  const hiddenFillCount = Math.max((order?.fills.length ?? 0) - visibleFills.length, 0);
  const createNotice =
    notice.kind === 'success' || notice.kind === 'warning' || notice.kind === 'error';

  function parseCashAmount(): bigint {
    if (!selectedSourceAsset || isDefaultSource) return usdc(amount);
    return parseUnits(amount, selectedSourceAsset.decimals);
  }

  function selectedRelaySource(): RelaySourceInput | undefined {
    if (!selectedSourceAsset || isDefaultSource) return undefined;
    return {
      chainId: selectedSourceAsset.chainId,
      currency: selectedSourceAsset.address,
    };
  }

  function handleSourceChainChange(nextChainId: string) {
    setSourceChainId(nextChainId);
    const nextChain = sourceChains.find((chain) => chain.id === Number(nextChainId));
    const nextAsset = nextChain?.tokens[0];
    if (nextAsset) setSourceAssetKey(sourceKey(nextChain!.id, nextAsset.address));
    setEstimate(null);
  }

  function handleSourceAssetChange(nextAssetKey: string) {
    setSourceAssetKey(nextAssetKey);
    setEstimate(null);
  }

  return (
    <main className="app-root">
      <header className="app-header">
        <img src="/logos/peer-logo-white.svg" alt="Peer" />
        <button
          type="button"
          className="button button-tertiary"
          onClick={handleConnect}
          disabled={busy != null}
        >
          {account ? shortAddress(account) : busy === 'connect' ? 'Connecting' : 'Connect'}
        </button>
      </header>

      <section className="intro">
        <div>
          <p className="kicker">Peer Cash SDK demo</p>
          <div className="title-row">
            <h1>
              <span>Cash out</span> <span>USDC</span>
            </h1>
          </div>
          <div className="ignite-rule" />
          <p>Enter amount and payee. Peer handles matching and proof.</p>
        </div>
      </section>

      <section className="workspace" aria-label="Peer Cash integration">
        <form
          id="cashout"
          className="panel create-panel"
          onSubmit={(event) => {
            event.preventDefault();
            void handleCashout();
          }}
        >
          <div className="panel-header">
            <div>
              <p className="kicker">Create</p>
              <h2>New cash-out</h2>
            </div>
          </div>

          <div className="form-grid">
            <Field label="Amount">
              <input
                name="amount"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder={selectedSourceAsset?.symbol === 'USDC' ? '1' : '0.01'}
              />
            </Field>
            <Field label="Source chain">
              <select
                name="sourceChain"
                value={String(selectedSourceChain?.id ?? sourceChainId)}
                onChange={(event) => handleSourceChainChange(event.target.value)}
                disabled={sourceLoading && sourceChains.length <= 1}
              >
                {sourceChains.map((chain) => (
                  <option key={chain.id} value={chain.id}>
                    {chain.displayName}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Source asset"
              hint={
                sourceLoadFailed
                  ? 'Relay source discovery failed; Base USDC is still available.'
                  : sourceLoading
                    ? 'Loading Relay source assets.'
                    : isDefaultSource
                      ? 'Default route: no Relay bridge.'
                      : 'Relay routes this asset into Base USDC first.'
              }
            >
              <select
                name="sourceAsset"
                value={sourceAssetKey}
                onChange={(event) => handleSourceAssetChange(event.target.value)}
                disabled={!selectedSourceChain || selectedSourceChain.tokens.length === 0}
              >
                {selectedSourceChain?.tokens.map((asset) => (
                  <option
                    key={sourceKey(selectedSourceChain.id, asset.address)}
                    value={sourceKey(selectedSourceChain.id, asset.address)}
                  >
                    {tokenLabel(asset)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Platform">
              <select
                name="platform"
                value={platform}
                onChange={(event) => setPlatform(event.target.value)}
              >
                {capabilities.platforms.map((capability) => (
                  <option
                    key={capability.platform}
                    value={capability.platform}
                    disabled={capability.requiresIdentityAttestation}
                  >
                    {capability.requiresIdentityAttestation
                      ? `${capability.platform} - app required`
                      : capability.platform}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Currency">
              <select
                name="currency"
                value={currency}
                onChange={(event) => setCurrency(event.target.value as CurrencyType)}
              >
                {currencies.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Payee">
              <input
                name="payee"
                value={payee}
                onChange={(event) => setPayee(event.target.value)}
                placeholder={selectedPlatform?.payeeHint ?? 'Payment handle'}
              />
            </Field>
            {selectedPlatform?.payeeHint ? (
              <p className="payee-hint">{selectedPlatform.payeeHint}</p>
            ) : null}
          </div>

          <div className="estimate-strip">
            <div>
              <span>Receive estimate</span>
              <strong>
                {estimate ? formatNumber(estimate.receiveAmount, estimate.currency) : '-'}
              </strong>
            </div>
            <div>
              <span>Historical ETA</span>
              <strong>{formatEta(estimate?.eta)}</strong>
            </div>
            <div>
              <span>Source route</span>
              <strong>
                {estimate?.source
                  ? `${formatTokenAmount(
                      estimate.source.inputAmount,
                      estimate.source.asset.decimals,
                      estimate.source.asset.symbol,
                    )} -> ${formatUsdcShort(estimate.amount)}`
                  : sourceSummary}
              </strong>
            </div>
          </div>

          {createNotice && notice.text ? (
            <div className={`notice notice-${notice.kind}`}>{notice.text}</div>
          ) : null}

          <div className="button-row">
            <button
              type="button"
              className="button button-secondary"
              onClick={handleEstimate}
              disabled={busy != null}
            >
              {busy === 'estimate' ? 'Estimating' : 'Estimate'}
            </button>
            <button type="submit" className="button button-primary" disabled={!canCashout}>
              {busy === 'cashout' ? 'Creating' : 'Create cash-out'}
            </button>
          </div>
        </form>

        <section id="order" className="panel order-panel">
          <div className="panel-header">
            <div>
              <p className="kicker">Track</p>
              <h2>Order state</h2>
            </div>
            <StatusPill order={order} />
          </div>

          <div className="order-source">
            <div>
              <span>Wallet</span>
              <strong>{account ? shortAddress(account) : 'Connect to load orders'}</strong>
            </div>
            {orders.length > 1 ? (
              <select
                name="walletOrder"
                aria-label="Wallet cash-out"
                value={selectedDepositId}
                onChange={(event) => setSelectedDepositId(event.target.value)}
              >
                {orders.map((item) => (
                  <option key={item.depositId} value={item.depositId}>
                    {item.state} - {formatUsdcShort(item.totalAmount)}
                  </option>
                ))}
              </select>
            ) : null}
          </div>

          <dl className="metrics">
            <Metric label="Total" value={order ? formatUsdcShort(order.totalAmount) : '-'} />
            <Metric label="Filled" value={order ? formatUsdcShort(order.filledAmount) : '-'} />
            <Metric label="Pending" value={order ? formatUsdcShort(order.pendingAmount) : '-'} />
            <Metric label="Returned" value={order ? formatUsdcShort(order.returnedAmount) : '-'} />
          </dl>

          <div className="action-band">
            <div>
              <span>Next actions</span>
              <strong>{order?.nextActions.length ? order.nextActions.join(', ') : 'None'}</strong>
            </div>
            <div className="button-row button-row-tight">
              <button
                type="button"
                className="button button-tertiary"
                onClick={handleRefresh}
                disabled={busy != null}
              >
                {busy === 'refresh' ? 'Refreshing' : 'Refresh'}
              </button>
              <button
                type="button"
                className="button button-tertiary"
                onClick={handleWithdraw}
                disabled={!canWithdraw}
              >
                {busy === 'withdraw' ? 'Withdrawing' : 'Withdraw'}
              </button>
            </div>
          </div>

          <div className="fills">
            <div className="fills-header">
              <span>Fills</span>
              <strong>{filledCount || order?.fills.length || 0}</strong>
            </div>
            {visibleFills.length ? (
              <ul role="list">
                {visibleFills.map((fill) => (
                  <li key={fill.intentHash}>
                    <div>
                      <strong>{fill.status}</strong>
                      <span>{shortAddress(fill.buyer)}</span>
                    </div>
                    <div>
                      <span>{formatUsdcShort(fill.amount)}</span>
                      <span>{formatNumber(fill.fiatOwed, fill.currency)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No buyer has matched this deposit.</p>
            )}
            {hiddenFillCount > 0 ? (
              <p className="fills-more">
                +{hiddenFillCount} older fill{hiddenFillCount === 1 ? '' : 's'}
              </p>
            ) : null}
          </div>
        </section>
      </section>

      {lastTx ? (
        <a
          className="tx-link"
          href={`https://basescan.org/tx/${lastTx}`}
          target="_blank"
          rel="noreferrer"
        >
          View latest transaction
        </a>
      ) : null}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
