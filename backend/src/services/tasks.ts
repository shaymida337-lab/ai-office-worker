import { prisma } from "../lib/prisma.js";
import { safeInvalidateDashboardBootstrap } from "./dashboardBootstrapCache.js";

const taskResponseSelect = {
  id: true,
  title: true,
  dueDate: true,
  status: true,
} as const;

export async function createTask(input: {
  organizationId: string;
  title: string;
  description?: string | null;
  dueDate?: Date | null;
  priority?: string;
  status?: string;
  source?: string;
}) {
  const task = await prisma.task.create({
    data: {
      organizationId: input.organizationId,
      title: input.title,
      description: input.description ?? null,
      dueDate: input.dueDate ?? null,
      priority: input.priority ?? "medium",
      status: input.status ?? "open",
      source: input.source ?? "manual",
    },
    select: taskResponseSelect,
  });
  safeInvalidateDashboardBootstrap(undefined, input.organizationId);
  return task;
}

export async function completeTask(input: {
  organizationId: string;
  taskId: string;
}) {
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.task.updateMany({
      where: {
        id: input.taskId,
        organizationId: input.organizationId,
      },
      data: { status: "completed" },
    });

    if (updated.count === 0) {
      return null;
    }

    if (updated.count !== 1) {
      throw new Error("Expected exactly one task to be completed");
    }

    return tx.task.findFirst({
      where: {
        id: input.taskId,
        organizationId: input.organizationId,
      },
      select: taskResponseSelect,
    });
  });
  if (result) safeInvalidateDashboardBootstrap(undefined, input.organizationId);
  return result;
}

export async function findTasksByPartialTitle(input: {
  organizationId: string;
  title: string;
  status?: string;
  limit?: number;
}) {
  const title = input.title.trim();
  if (!title) {
    return [];
  }

  return prisma.task.findMany({
    where: {
      organizationId: input.organizationId,
      ...(input.status ? { status: input.status } : {}),
      title: {
        contains: title,
        mode: "insensitive",
      },
    },
    orderBy: { createdAt: "desc" },
    take: input.limit ?? 10,
    select: {
      id: true,
      title: true,
      status: true,
    },
  });
}
