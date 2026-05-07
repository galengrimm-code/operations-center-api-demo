"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { exchangeCodeForTokens } from "@/lib/john-deere-client";
import { useAuth } from "@/contexts/auth-context";
import { Loader as Loader2 } from "lucide-react";

export default function CallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, refreshJohnDeereConnection } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const hasProcessed = useRef(false);

  useEffect(() => {
    const handleCallback = async () => {
      // Prevent duplicate processing
      if (hasProcessed.current) {
        return;
      }

      console.log("[callback] Starting callback handler");
      const code = searchParams.get("code");
      const errorParam = searchParams.get("error");
      const errorDescription = searchParams.get("error_description");

      console.log("[callback] Code present:", !!code);
      console.log("[callback] Error param:", errorParam);
      console.log("[callback] User:", user?.id);

      if (errorParam) {
        setError(errorDescription || errorParam);
        return;
      }

      if (!code) {
        setError("No authorization code received");
        return;
      }

      if (!user) {
        // Don't show error immediately - user might still be loading
        return;
      }

      // Mark as processing to prevent duplicate runs
      hasProcessed.current = true;
      setIsProcessing(true);

      try {
        const redirectUri = `${window.location.origin}/auth/callback`;
        console.log("[callback] Calling exchangeCodeForTokens...");
        await exchangeCodeForTokens(code, redirectUri);
        console.log("[callback] Token exchange complete, refreshing connection...");
        await refreshJohnDeereConnection();
        console.log("[callback] Connection refreshed, redirecting to dashboard");
        router.push("/map");
      } catch (err) {
        console.error("[callback] Error during callback:", err);
        setError(err instanceof Error ? err.message : "Failed to connect to John Deere");
        setIsProcessing(false);
        hasProcessed.current = false; // Allow retry
      }
    };

    if (user !== undefined) {
      handleCallback();
    }
  }, [searchParams, user, router, refreshJohnDeereConnection]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <div className="glass-panel mx-4 w-full max-w-md rounded-2xl p-8">
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl border border-red-500/20 bg-red-500/10">
              <svg
                className="h-7 w-7 text-red-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </div>
            <h1 className="mb-2 text-xl font-semibold text-white">Connection Failed</h1>
            <p className="mb-6 text-sm text-slate-400">{error}</p>
            <button
              onClick={() => router.push("/map")}
              className="rounded-xl bg-emerald-500 px-6 py-2.5 font-medium text-white shadow-lg shadow-emerald-500/25 transition-colors hover:bg-emerald-400"
            >
              Back to Map
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950">
      <div className="glass-panel mx-4 w-full max-w-md rounded-2xl p-8">
        <div className="text-center">
          <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin text-emerald-400" />
          <h1 className="mb-2 text-lg font-semibold text-white">Connecting to John Deere</h1>
          <p className="text-sm text-slate-400">Please wait while we complete the connection...</p>
        </div>
      </div>
    </div>
  );
}
