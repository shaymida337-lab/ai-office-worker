import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateGmailReconnectRequired,
  missingRequiredGmailConnectionScopes,
  REQUIRED_GMAIL_CONNECTION_SCOPE,
} from "./gmailConnectionStatus.js";
import { missingRequiredGoogleDriveScopes } from "./google.js";

describe("gmail connection status", () => {
  it("does not require reconnect when refresh token exists but scope metadata is empty (legacy connected)", () => {
    assert.equal(
      evaluateGmailReconnectRequired({
        hasRefreshToken: true,
        refreshInvalidGrant: false,
        grantedScopes: [],
        scopeSource: "unknown",
      }),
      false
    );
  });

  it("requires reconnect when Google returns invalid_grant", () => {
    assert.equal(
      evaluateGmailReconnectRequired({
        hasRefreshToken: true,
        refreshInvalidGrant: true,
        grantedScopes: [],
        scopeSource: "unknown",
      }),
      true
    );
  });

  it("requires reconnect when live scopes are known and gmail.readonly is missing", () => {
    assert.equal(
      evaluateGmailReconnectRequired({
        hasRefreshToken: true,
        refreshInvalidGrant: false,
        grantedScopes: ["https://www.googleapis.com/auth/drive.file"],
        scopeSource: "live",
      }),
      true
    );
  });

  it("does not require reconnect when gmail.readonly is granted even if drive.file is missing", () => {
    assert.equal(
      evaluateGmailReconnectRequired({
        hasRefreshToken: true,
        refreshInvalidGrant: false,
        grantedScopes: [REQUIRED_GMAIL_CONNECTION_SCOPE],
        scopeSource: "live",
      }),
      false
    );
    assert.deepEqual(
      missingRequiredGoogleDriveScopes([REQUIRED_GMAIL_CONNECTION_SCOPE]),
      ["https://www.googleapis.com/auth/drive.file"]
    );
  });

  it("detects missing gmail.readonly explicitly", () => {
    assert.deepEqual(missingRequiredGmailConnectionScopes([]), [REQUIRED_GMAIL_CONNECTION_SCOPE]);
    assert.deepEqual(missingRequiredGmailConnectionScopes([REQUIRED_GMAIL_CONNECTION_SCOPE]), []);
  });
});
