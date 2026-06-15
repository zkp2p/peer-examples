import type { BuyerTeePaymentParams, BuyerTeeSessionMaterial } from '@utils/buyerTeePaymentCapture';
import { computeParamValues } from '@utils/metadataEngine';
import type { MetadataMessageType, ProviderSettings } from '@utils/types';

import type { RequestLog } from './requestLog';

type ParamSelector = ProviderSettings['paramSelectors'][number];

type PrepareBuyerTeeCaptureMaterialParams = {
  metadata?: MetadataMessageType[];
  paramResponseBodyString?: string;
  providerConfig: ProviderSettings;
  request: RequestLog | null | undefined;
};

type BuyerTeeCaptureMaterial = {
  metadata?: MetadataMessageType[];
  params: BuyerTeePaymentParams[];
  sessionMaterial: BuyerTeeSessionMaterial;
};

function buildRequestBody(request: RequestLog): string | null {
  if (request.formData && Object.keys(request.formData).length > 0) {
    const formData = new URLSearchParams();
    Object.entries(request.formData).forEach(([key, values]) => {
      if (!Array.isArray(values)) return;
      values.forEach((value: string) => formData.append(key, value));
    });
    return formData.toString();
  }

  return typeof request.requestBody === 'string' ? request.requestBody : null;
}

function buildBuyerTeeSessionMaterial(request: RequestLog): BuyerTeeSessionMaterial {
  const sessionMaterial: BuyerTeeSessionMaterial = {};

  for (const header of request.requestHeaders) {
    const headerName = header.name?.trim();
    if (!headerName || typeof header.value !== 'string') {
      continue;
    }
    sessionMaterial[headerName] = header.value;
  }

  const body = buildRequestBody(request);
  if (body !== null) {
    sessionMaterial.body = body;
  }

  return sessionMaterial;
}

function selectorUsesResponseBody(selector: ParamSelector | undefined): boolean {
  return !selector?.source || selector.source === 'responseBody';
}

function isPublicParamSelector(selector: ParamSelector | undefined): boolean {
  return selector?.source !== 'requestBody';
}

function getPublicParamConfig(providerConfig: ProviderSettings): {
  paramNames: string[];
  paramSelectors: ParamSelector[];
} {
  return providerConfig.paramNames.reduce<{
    paramNames: string[];
    paramSelectors: ParamSelector[];
  }>(
    (acc, paramName, index) => {
      const trimmedName = paramName.trim();
      const selector = providerConfig.paramSelectors[index];
      if (trimmedName && isPublicParamSelector(selector)) {
        acc.paramNames.push(trimmedName);
        acc.paramSelectors.push(selector);
      }
      return acc;
    },
    { paramNames: [], paramSelectors: [] },
  );
}

export function shouldResolveBuyerTeeParamResponseBody(providerConfig: ProviderSettings): boolean {
  const { paramSelectors } = getPublicParamConfig(providerConfig);
  return paramSelectors.some(selectorUsesResponseBody);
}

function buildBuyerTeePaymentParams({
  metadata,
  paramResponseBodyString,
  providerConfig,
  request,
}: {
  metadata?: MetadataMessageType[];
  paramResponseBodyString?: string;
  providerConfig: ProviderSettings;
  request: RequestLog;
}): Pick<BuyerTeeCaptureMaterial, 'metadata' | 'params'> {
  const rows: MetadataMessageType[] = metadata ?? [];
  const publicParamConfig = getPublicParamConfig(providerConfig);
  const requiresPublicParams = publicParamConfig.paramNames.length > 0;

  const responseBodyString = paramResponseBodyString ?? String(request.responseBody || '');
  const params: BuyerTeePaymentParams[] = [];
  const metadataWithParams: MetadataMessageType[] = [];

  rows.forEach((row, fallbackIndex) => {
    const originalIndex = Number.isInteger(row.originalIndex) ? row.originalIndex : fallbackIndex;
    const paymentParams: BuyerTeePaymentParams = {};

    const paramValues = computeParamValues(
      publicParamConfig.paramNames,
      publicParamConfig.paramSelectors,
      request,
      responseBodyString,
      originalIndex,
    );

    publicParamConfig.paramNames.forEach((paramName, paramIndex) => {
      const paramKey = paramName.trim();
      if (!paramKey) {
        return;
      }

      const paramValue = (paramValues[paramName] ?? '').trim();
      if (!paramValue) {
        return;
      }

      paymentParams[paramKey] = paramValue;
    });

    params.push(paymentParams);
    metadataWithParams.push({ ...row, params: paymentParams });
  });

  if (requiresPublicParams && rows.length === 0) {
    throw new Error('Session metadata unavailable. Re-authenticate and try again.');
  }

  return {
    ...(metadata ? { metadata: metadataWithParams } : {}),
    params,
  };
}

export function prepareBuyerTeeCaptureMaterial(
  params: PrepareBuyerTeeCaptureMaterialParams,
): BuyerTeeCaptureMaterial {
  if (!params.request) {
    throw new Error('Session capture unavailable. Re-authenticate and try again.');
  }

  const paymentCapture = buildBuyerTeePaymentParams({
    metadata: params.metadata,
    paramResponseBodyString: params.paramResponseBodyString,
    providerConfig: params.providerConfig,
    request: params.request,
  });

  return {
    ...paymentCapture,
    sessionMaterial: buildBuyerTeeSessionMaterial(params.request),
  };
}
