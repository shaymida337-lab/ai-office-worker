"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { saveToken } from "@/lib/auth";

function CallbackInner() {
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const token = params.get("token") ?? hashParams.get("token");
    if (!token) {
      router.replace("/?error=missing_token");
      return;
    }

    saveToken(token);
    window.location.replace("/dashboard");
  }, [params, router]);

  return (
    <div className="container text-center">
      <p>מתחבר...</p>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense>
      <CallbackInner />
    </Suspense>
  );
}
