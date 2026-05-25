import dynamic from "next/dynamic";
import { AppSplash } from "@/components/AppSplash";

const SocialClient = dynamic(() => import("./SocialClient"), {
  loading: () => <AppSplash compact label="טוען את מרכז הסושיאל..." />,
});

export default function SocialPage() {
  return <SocialClient />;
}
