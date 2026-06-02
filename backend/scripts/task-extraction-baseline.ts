import assert from "node:assert/strict";
import { analyzeEmailContent } from "../src/services/claude.js";

type Case = {
  name: string;
  input: Parameters<typeof analyzeEmailContent>[0];
  expectTask: boolean;
  intent: RegExp;
};

const cases: Case[] = [
  {
    name: "follow-up request should become a task",
    input: {
      sender: "Dana Client <dana@example.com>",
      subject: "Follow up on the contract",
      body: "Can you please follow up with me tomorrow about the contract approval?",
      filenames: [],
    },
    expectTask: true,
    intent: /follow|חזור|עדכ|contract|approval/i,
  },
  {
    name: "scheduling request should become a task",
    input: {
      sender: "Yossi Client <yossi@example.com>",
      subject: "Schedule a meeting",
      body: "Please schedule a meeting with me next week to review the project timeline.",
      filenames: [],
    },
    expectTask: true,
    intent: /schedule|meeting|פגישה|יומן|timeline/i,
  },
  {
    name: "quote request should become a task",
    input: {
      sender: "lead@example.com",
      subject: "Need a quote",
      body: "Hi, please send me a quote for monthly bookkeeping services.",
      filenames: [],
    },
    expectTask: true,
    intent: /quote|proposal|הצעת|מחיר|bookkeeping/i,
  },
  {
    name: "payment chase should become a task",
    input: {
      sender: "supplier@example.com",
      subject: "Payment reminder",
      body: "This is a reminder that invoice INV-44 for 1,200 ILS is overdue. Please arrange payment.",
      filenames: [],
    },
    expectTask: true,
    intent: /payment|pay|overdue|תשלום|INV-44/i,
  },
  {
    name: "newsletter should not become a task",
    input: {
      sender: "newsletter@marketing.example",
      subject: "Weekly newsletter",
      body: "Here are this week's tips and promotions. Unsubscribe anytime.",
      filenames: [],
    },
    expectTask: false,
    intent: /.*/,
  },
  {
    name: "system notification should not become a task",
    input: {
      sender: "no-reply@render.com",
      subject: "Deployment succeeded",
      body: "Your service deployed successfully. No action is required.",
      filenames: [],
    },
    expectTask: false,
    intent: /.*/,
  },
  {
    name: "pure FYI thank-you should not become a task",
    input: {
      sender: "client@example.com",
      subject: "Thanks",
      body: "Thank you for the update. Looks good to me.",
      filenames: [],
    },
    expectTask: false,
    intent: /.*/,
  },
];

async function main() {
  let failures = 0;

  for (const testCase of cases) {
    const result = await analyzeEmailContent(testCase.input);
    const taskText = result.tasks.join(" | ");

    try {
      if (testCase.expectTask) {
        assert.ok(result.tasks.length > 0, "expected at least one task");
        assert.match(taskText, testCase.intent);
      } else {
        assert.equal(result.tasks.length, 0, "expected no tasks");
      }
      console.log(`PASS ${testCase.name}`);
      console.log(`  tasks=${JSON.stringify(result.tasks)}`);
      console.log(`  documentType=${result.documentType} paymentRequired=${result.paymentRequired} confidence=${result.confidence}`);
    } catch (err) {
      failures++;
      console.log(`FAIL ${testCase.name}`);
      console.log(`  tasks=${JSON.stringify(result.tasks)}`);
      console.log(`  documentType=${result.documentType} paymentRequired=${result.paymentRequired} confidence=${result.confidence}`);
      console.log(`  reason=${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\nBaseline: ${cases.length - failures}/${cases.length} passed, ${failures} failed`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
