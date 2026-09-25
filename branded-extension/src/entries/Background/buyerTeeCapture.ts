import type { BuyerTeePaymentParams, BuyerTeeSessionMaterial } from '@utils/buyerTeePaymentCapture';
import type { MetadataMessageType } from '@utils/types';

import type { RequestLog } from './requestLog';

type PrepareBuyerTeeCaptureMaterialParams = {
  metadata?: MetadataMessageType[];
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

function buildBuyerTeePaymentParams(
  metadata?: MetadataMessageType[],
): Pick<BuyerTeeCaptureMaterial, 'metadata' | 'params'> {
  const rows: MetadataMessageType[] = metadata ?? [];
  const metadataWithParams = rows.map((row) => ({ ...row, params: row.params ?? {} }));
  const params: BuyerTeePaymentParams[] = metadataWithParams.map((row) => row.params);

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

  const paymentCapture = buildBuyerTeePaymentParams(params.metadata);

  return {
    ...paymentCapture,
    sessionMaterial: buildBuyerTeeSessionMaterial(params.request),
  };
}
