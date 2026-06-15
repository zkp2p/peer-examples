import { BRAND, type Brand } from '@config/brand';
import { logger } from '@utils/logger';

type InstallInjectionPlan = {
  files: string[];
  url: string[];
};

export function getInstallInjectionPlans(
  brand: Pick<Brand, 'appOrigins' | 'hostDomains'> = BRAND,
): InstallInjectionPlan[] {
  return [
    {
      files: ['txClickGuideLoader.bundle.js'],
      url: brand.hostDomains,
    },
    {
      files: ['contentScriptLoader.bundle.js'],
      url: brand.appOrigins,
    },
  ].filter((plan) => plan.url.length > 0);
}

export function installContentScriptsInExistingTabs(): void {
  for (const plan of getInstallInjectionPlans()) {
    chrome.tabs.query({ url: plan.url }, (tabs) => {
      tabs.forEach((tab) => {
        if (!tab.id) return;
        chrome.scripting
          .executeScript({
            target: { tabId: tab.id },
            files: plan.files,
          })
          .catch((error) => {
            logger.warn(`[Background] Failed to inject content loaders into tab ${tab.id}`, error);
          });
      });
    });
  }
}
