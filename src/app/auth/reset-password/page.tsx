import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/app/login/auth-shell";
import { SetPasswordSubmit } from "@/app/login/magic-link-submit";
import { authErrorMessage, loginUrl } from "@/lib/auth/redirects";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Set new password" };

async function setNewPassword(formData: FormData) {
  "use server";

  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < 6 || password.length > 256) {
    redirect("/auth/reset-password?error=invalid_password");
  }
  if (password !== confirm) {
    redirect("/auth/reset-password?error=password_mismatch");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) redirect("/auth/reset-password?error=unavailable");

  await supabase.auth.signOut({ scope: "global" });
  redirect("/login?reset_done=1");
}

type SearchParams = Promise<{ error?: string }>;

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { error: errorCode } = await searchParams;
  const error = authErrorMessage(errorCode);
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  if (!data.user) redirect(loginUrl({ error: "link" }));

  const inputClassName =
    "min-h-11 h-[52px] rounded-pill border border-rule-strong bg-surface-sunken px-md text-[16px] text-ink outline-none transition-colors placeholder:text-grey focus-visible:border-accent focus-ring";
  const fieldLabelClassName =
    "text-caption font-medium uppercase tracking-[0.18em] text-grey";

  return (
    <AuthShell
      eyebrow="Cellar access"
      title="Set new password"
      description={`Choose a password for ${data.user.email}`}
    >
      <form action={setNewPassword} className="flex flex-col gap-md">
        <label htmlFor="new-password" className="flex flex-col gap-xs">
          <span className={fieldLabelClassName}>New password</span>
          <input
            id="new-password"
            type="password"
            name="password"
            autoComplete="new-password"
            required
            minLength={6}
            maxLength={256}
            aria-describedby={error ? "reset-password-error" : undefined}
            placeholder="At least 6 characters"
            className={inputClassName}
          />
        </label>
        <label htmlFor="confirm-password" className="flex flex-col gap-xs">
          <span className={fieldLabelClassName}>Confirm password</span>
          <input
            id="confirm-password"
            type="password"
            name="confirm"
            autoComplete="new-password"
            required
            minLength={6}
            maxLength={256}
            aria-describedby={error ? "reset-password-error" : undefined}
            placeholder="Enter the same password"
            className={inputClassName}
          />
        </label>
        {error && (
          <div
            id="reset-password-error"
            role="alert"
            aria-live="assertive"
            className="rounded-card border border-risk-ink/30 bg-risk-wash p-md text-body-sm text-risk-ink"
          >
            {error}
          </div>
        )}
        <SetPasswordSubmit />
      </form>
    </AuthShell>
  );
}
