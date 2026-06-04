import { answerBusinessQuestionWithClaude } from "./claude.js";
import { getDashboardStats } from "./dashboard.js";

export async function askNatalieBusinessQuestion(input: {
  organizationId: string;
  question: string;
}): Promise<string> {
  const stats = await getDashboardStats(input.organizationId);

  return answerBusinessQuestionWithClaude({
    question: input.question,
    businessContext: {
      dashboardStats: stats,
    },
  });
}
