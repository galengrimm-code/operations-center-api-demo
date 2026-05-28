"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { Loader2, Tractor, Mail, Lock } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const { signIn, signUp } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const { error } = isSignUp ? await signUp(email, password) : await signIn(email, password);

      if (error) {
        setError(error.message);
      } else {
        // SAFETY: if you wire up the `redirect` query param (set by middleware.ts on auth-protected paths),
        // validate it before using: must start with `/`, must NOT start with `//` or `/\`, must not match `^https?://`.
        // Otherwise: open-redirect to attacker-controlled URLs. See Task 0.3 review notes.
        router.push("/map");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
      {/* Subtle grid background */}
      <div className="fixed inset-0 bg-[linear-gradient(rgba(16,185,129,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(16,185,129,0.03)_1px,transparent_1px)] bg-[size:64px_64px]" />

      <div className="relative w-full max-w-md">
        <div className="glass-panel overflow-hidden rounded-2xl">
          {/* Header */}
          <div className="px-8 pb-8 pt-10 text-center">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-xl bg-emerald-500 shadow-lg shadow-emerald-500/25">
              <Tractor className="h-7 w-7 text-white" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-white">Farm Data Hub</h1>
            <p className="mt-2 text-sm text-slate-400">Connect to John Deere Operations Center</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5 px-8 pb-8">
            {error && (
              <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium text-slate-300">
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full rounded-xl border border-white/[0.08] bg-white/[0.03] py-3 pl-10 pr-4 text-sm text-slate-200 transition-colors placeholder:text-slate-500 focus:border-emerald-500/30 focus:outline-none focus:ring-1 focus:ring-emerald-500/20"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium text-slate-300">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full rounded-xl border border-white/[0.08] bg-white/[0.03] py-3 pl-10 pr-4 text-sm text-slate-200 transition-colors placeholder:text-slate-500 focus:border-emerald-500/30 focus:outline-none focus:ring-1 focus:ring-emerald-500/20"
                  required
                  minLength={6}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full rounded-xl bg-emerald-500 py-3 font-medium text-white shadow-lg shadow-emerald-500/25 transition-colors hover:bg-emerald-400 disabled:opacity-50"
            >
              {isLoading ? (
                <Loader2 className="mx-auto h-5 w-5 animate-spin" />
              ) : isSignUp ? (
                "Create Account"
              ) : (
                "Sign In"
              )}
            </button>

            <div className="text-center">
              <button
                type="button"
                onClick={() => {
                  setIsSignUp(!isSignUp);
                  setError(null);
                }}
                className="text-sm font-medium text-emerald-400 transition-colors hover:text-emerald-300"
              >
                {isSignUp ? "Already have an account? Sign in" : "Don't have an account? Sign up"}
              </button>
            </div>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-slate-600">
          Securely connect your farm data from John Deere Operations Center
        </p>
      </div>
    </div>
  );
}
