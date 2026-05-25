import dynamic from "next/dynamic";
import { AppSplash } from "@/components/AppSplash";

const ReportsClient = dynamic(() => import("./ReportsClient"), {
  loading: () => <AppSplash compact label="טוען דוחות..." />,
});

export default function ReportsPage() {
  return <ReportsClient />;
}
