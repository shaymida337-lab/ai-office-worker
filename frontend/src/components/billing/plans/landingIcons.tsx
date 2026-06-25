import type { LucideIcon } from "lucide-react";
import {
  Building2,
  CalendarDays,
  CheckSquare,
  FileScan,
  FileSpreadsheet,
  Mail,
  MessageCircle,
  Receipt,
  UserRound,
  Wallet,
} from "lucide-react";

export const LANDING_FEATURE_ICONS: Record<string, LucideIcon> = {
  "קוראת מיילים": Mail,
  "סורקת מסמכים": FileScan,
  "מנפיקה חשבוניות וקבלות": Receipt,
  "יומן ופגישות": CalendarDays,
  "ניהול משימות": CheckSquare,
  "תשלומים לספקים": Wallet,
  "ניהול לקוחות": UserRound,
  "ניהול ספקים": Building2,
  "צ'אט וקול": MessageCircle,
  "הכנה לרואה החשבון": FileSpreadsheet,
};
