import dynamic from "next/dynamic";
import { AppSplash } from "@/components/AppSplash";

const ReportsClient = dynamic(() => import("./ReportsClient"), {
  loading: () => <AppSplash compact label="טוען השלמת חשבוניות..." />,
});

export default function ReportsPage() {
  return <ReportsClient />;
}
