export type DocumentReviewApprovalResponse = {
  success?: boolean;
  ok?: boolean;
  reviewId?: string;
  supplierPaymentId?: string;
  paymentId?: string;
  status?: string;
};

export const APPROVAL_SUCCESS_MESSAGE = "המסמך אושר והועבר לחשבוניות";
export const APPROVAL_FAILURE_MESSAGE = "האישור נכשל — המסמך נשאר לבדיקה ולא נמחק";

export function isConfirmedApprovalResponse(result: DocumentReviewApprovalResponse | null | undefined): boolean {
  if (!result) return false;
  const paymentId = result.supplierPaymentId ?? result.paymentId;
  if (!paymentId?.trim()) return false;
  if (result.success === false || result.ok === false) return false;
  return result.success === true || result.ok === true || Boolean(paymentId);
}

export function shouldRemoveReviewAfterApproval(result: DocumentReviewApprovalResponse | null | undefined): boolean {
  return isConfirmedApprovalResponse(result);
}
