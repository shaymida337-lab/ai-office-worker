import test from "node:test";
import assert from "node:assert/strict";

import { buildFastScanQueries } from "./gmailFastScanQuery.js";

type GmailMessageRef = { id?: string | null };

async function collectFastScanListing(
  gmail: {
    users: {
      messages: {
        list: (args: { q: string; maxResults?: number; pageToken?: string }) => Promise<{
          data: { messages?: GmailMessageRef[]; nextPageToken?: string | null };
        }>;
      };
    };
  },
  maxMessages = 20
) {
  const byId = new Map<string, GmailMessageRef>();
  const queries = buildFastScanQueries();

  for (const q of queries) {
    const result = await gmail.users.messages.list({ userId: "me", q, maxResults: maxMessages });
    for (const message of result.data.messages ?? []) {
      if (message.id) byId.set(message.id, message);
    }
  }

  return [...byId.values()].slice(0, maxMessages);
}

test("fast scan listing finds recent invoice attachment from mock Gmail API", async () => {
  const invoiceMessage = { id: "msg-invoice-001" };
  const seenQueries: string[] = [];

  const gmail = {
    users: {
      messages: {
        list: async ({ q }: { q: string }) => {
          seenQueries.push(q);
          if (q.includes("has:attachment") && q.includes("newer_than:1d")) {
            return { data: { messages: [invoiceMessage] } };
          }
          return { data: { messages: [] } };
        },
      },
    },
  };

  const messages = await collectFastScanListing(gmail);
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.id, "msg-invoice-001");
  assert.ok(seenQueries.some((q) => q.includes("filename:jpg")));
  assert.ok(seenQueries.some((q) => q.includes("in:sent")));
});

test("fast scan listing returns empty when mock Gmail has no matching messages", async () => {
  const gmail = {
    users: {
      messages: {
        list: async () => ({ data: { messages: [] } }),
      },
    },
  };

  const messages = await collectFastScanListing(gmail);
  assert.equal(messages.length, 0);
  assert.ok(buildFastScanQueries().length >= 5);
});
