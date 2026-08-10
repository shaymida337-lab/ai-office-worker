export type CompletionListViewState = "loading" | "error" | "empty" | "list";

/** Mutually exclusive UI states for the invoice completion list shell. */
export function resolveCompletionListViewState(input: {
  loading: boolean;
  listLoadError: string | null;
  rowCount: number;
}): CompletionListViewState {
  if (input.loading) return "loading";
  if (input.listLoadError) return "error";
  if (input.rowCount === 0) return "empty";
  return "list";
}
