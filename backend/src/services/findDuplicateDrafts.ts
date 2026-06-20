export type DuplicateDraftInput = {
  id: string;
  customerName: string;
  customerEmail?: string | null;
  amount: number;
};

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function duplicateKey(draft: DuplicateDraftInput): string {
  const email = draft.customerEmail?.trim();
  if (email) {
    return `${normalize(email)}:${draft.amount}`;
  }
  return `${normalize(draft.customerName)}:${draft.amount}`;
}

export function findDuplicateDrafts(drafts: DuplicateDraftInput[]): Record<string, string[]> {
  const groups = new Map<string, string[]>();

  for (const draft of drafts) {
    const key = duplicateKey(draft);
    const members = groups.get(key) ?? [];
    members.push(draft.id);
    groups.set(key, members);
  }

  const result: Record<string, string[]> = {};

  for (const memberIds of groups.values()) {
    if (memberIds.length < 2) continue;

    for (const id of memberIds) {
      result[id] = memberIds.filter((otherId) => otherId !== id);
    }
  }

  return result;
}
