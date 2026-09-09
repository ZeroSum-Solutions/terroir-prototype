"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Check, Loader2, X } from "lucide-react";
import { AuthShell } from "@/app/login/auth-shell";
import { readApiError } from "@/lib/api/client-error";

export default function AcceptInvitePage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "success" | "error">(
    "loading",
  );
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function accept() {
      try {
        const res = await fetch("/api/team/accept-invite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: params.token }),
        });

        const data = await res.json().catch(() => null);

        if (res.ok) {
          setStatus("success");
          setMessage(data?.message ?? "You have joined the restaurant.");
          // Redirect to role-aware home after 2 seconds; "/" hits the
          // redirector at src/app/page.tsx which sends the user to
          // /insights (owner) or /cellar (manager/staff).
          setTimeout(() => router.push("/"), 2000);
        } else {
          if (res.status === 401) {
            // Not logged in — redirect to login with return URL
            router.push(`/login?next=/invite/${params.token}`);
            return;
          }
          setStatus("error");
          setMessage(readApiError(data, "Failed to accept invitation.").message);
        }
      } catch {
        setStatus("error");
        setMessage("Failed to accept invitation.");
      }
    }

    accept();
  }, [params.token, router]);

  return (
    <AuthShell eyebrow="Cellar access" title="Invitation">
      <div className="text-center">
        {status === "loading" && (
          <>
            <Loader2
              className="mx-auto h-8 w-8 animate-spin text-accent"
              aria-hidden="true"
            />
            <p className="mt-md text-body text-ink">Joining restaurant…</p>
          </>
        )}
        {status === "success" && (
          <>
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-ready-wash">
              <Check
                className="h-6 w-6 text-ready-ink"
                strokeWidth={2}
                aria-hidden="true"
              />
            </div>
            <p className="mt-md font-serif text-subheading font-normal text-ink">
              {message}
            </p>
            <p className="mt-xs text-ledger text-grey">Redirecting to Terroir…</p>
          </>
        )}
        {status === "error" && (
          <>
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-risk-wash">
              <X
                className="h-6 w-6 text-risk-ink"
                strokeWidth={2}
                aria-hidden="true"
              />
            </div>
            <p className="mt-md text-body font-medium text-ink">{message}</p>
            <button
              type="button"
              onClick={() => router.push("/login")}
              className="mx-auto mt-lg flex min-h-11 items-center rounded-pill bg-primary px-lg text-control font-semibold text-seal-ink transition-colors hover:bg-primary-hover focus-ring"
            >
              Go to login
            </button>
          </>
        )}
      </div>
    </AuthShell>
  );
}
