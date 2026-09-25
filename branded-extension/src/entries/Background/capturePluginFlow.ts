import type { PeerCapturePlugin } from '@utils/types/captureProgram';
import { assertCapturePlugin, isConfiguredCaptureOrigin } from '@utils/capturePlugin';
import { isApprovedCapturePlugin } from '@utils/capturePluginTrust';
import { getInstalledCapturePlugin, rememberCapturePlugin } from '@utils/extensionState';
import type { ApprovalPrompt } from '@utils/types';

export async function installCapturePlugin({
  actionType,
  platform,
  requestApproval,
  sourceHostname,
  sourceOrigin,
  value,
}: {
  actionType: string;
  platform: string;
  requestApproval: (prompt: ApprovalPrompt) => Promise<boolean>;
  sourceHostname: string;
  sourceOrigin: string;
  value: unknown;
}): Promise<PeerCapturePlugin> {
  const plugin = assertCapturePlugin(value, `${platform}/${actionType}`);
  if (plugin.origins.some((origin) => !isConfiguredCaptureOrigin(origin))) {
    throw new Error('Capture plugin requires a provider origin listed in brand.config.json hostDomains.');
  }
  const installed = await getInstalledCapturePlugin(plugin, sourceOrigin);
  if (installed) return installed;

  const verified = await isApprovedCapturePlugin(plugin);
  const providerHosts = plugin.origins.map((origin) => new URL(origin).hostname).join(', ');
  const approved = await requestApproval({
    approveLabel: 'Install',
    pluginTrust: verified ? 'verified' : 'unverified',
    detailsCollapsed: true,
    description: `Adds ${plugin.name} so this site can verify payments you make there.`,
    permissions: [
      `Open ${providerHosts}`,
      'Read your payment activity there',
      'Share matched activity with this site',
    ],
    details: [
      { label: 'Provider', value: plugin.origins.join('\n') },
      {
        label: 'Verification data',
        value:
          'Matched activity and encrypted account access. Raw cookies and headers stay in the extension.',
      },
      {
        label: 'After capture',
        value: plugin.shouldSkipCloseTab ? 'Keep tab open' : 'Close tab',
      },
    ],
    hostname: sourceHostname,
    origin: sourceOrigin,
    rejectLabel: 'Cancel',
    title: `Install ${plugin.name}?`,
    warning: 'Only for this site. Changes need your approval.',
  });
  if (!approved) throw new Error('Capture plugin installation was rejected.');

  await rememberCapturePlugin(plugin, sourceOrigin);
  return plugin;
}
