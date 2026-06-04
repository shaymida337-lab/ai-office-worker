import { prisma } from "../lib/prisma.js";

export async function createTask(input: {
  organizationId: string;
  title: string;
  description?: string | null;
  dueDate?: Date | null;
  priority?: string;
  status?: string;
  source?: string;
}) {
  return prisma.task.create({
    data: {
      organizationId: input.organizationId,
      title: input.title,
      description: input.description ?? null,
      dueDate: input.dueDate ?? null,
      priority: input.priority ?? "medium",
      status: input.status ?? "open",
      source: input.source ?? "manual",
    },
    select: {
      id: true,
      title: true,
      dueDate: true,
      status: true,
    },
  });
}
