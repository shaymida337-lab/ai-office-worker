import { decryptSecret, encryptSecret } from "./secretsCrypto.js";

type TokenFields = {
  accessToken?: string | null;
  refreshToken?: string | null;
};

export function encryptIntegrationTokens<T extends TokenFields>(data: T): T {
  return {
    ...data,
    accessToken: encryptSecret(data.accessToken) ?? data.accessToken,
    refreshToken: encryptSecret(data.refreshToken) ?? data.refreshToken,
  };
}

export function decryptIntegrationTokens<T extends TokenFields>(row: T): T {
  return {
    ...row,
    accessToken: decryptSecret(row.accessToken) ?? row.accessToken,
    refreshToken: decryptSecret(row.refreshToken) ?? row.refreshToken,
  };
}

export function encryptClientGoogleTokens<T extends { googleAccessToken?: string | null; googleRefreshToken?: string | null }>(
  data: T
): T {
  return {
    ...data,
    googleAccessToken: encryptSecret(data.googleAccessToken) ?? data.googleAccessToken,
    googleRefreshToken: encryptSecret(data.googleRefreshToken) ?? data.googleRefreshToken,
  };
}

export function decryptClientGoogleTokens<T extends { googleAccessToken?: string | null; googleRefreshToken?: string | null }>(
  row: T
): T {
  return {
    ...row,
    googleAccessToken: decryptSecret(row.googleAccessToken) ?? row.googleAccessToken,
    googleRefreshToken: decryptSecret(row.googleRefreshToken) ?? row.googleRefreshToken,
  };
}

export function stripClientGoogleTokens<T extends { googleAccessToken?: string | null; googleRefreshToken?: string | null }>(
  client: T
) {
  const { googleAccessToken: _a, googleRefreshToken: _r, ...safe } = client;
  return safe;
}
