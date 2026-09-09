import type { Metadata } from "next";
import { safeNext } from "@/lib/api/safe-redirect";
import { authErrorMessage } from "@/lib/auth/redirects";
import {
  sendMagicLink,
  sendPasswordReset,
  signInWithPassword,
  signUpWithPassword,
} from "./actions";
import { AuthShell } from "./auth-shell";
import {
  MagicLinkSubmit,
  PasswordSubmit,
  ResetPasswordSubmit,
} from "./magic-link-submit";

export const metadata: Metadata = { title: "Sign in" };

type SearchParams = Promise<{
  error?: string;
  mode?: string;
  next?: string;
  forgot?: string;
  sent?: string;
  signup?: string;
  reset?: string;
  reset_done?: string;
}>;

type LoginMode = "magic" | "password" | "signup";

function loginHref(mode: LoginMode, next: string): string {
  const params = new URLSearchParams({ mode });
  if (next !== "/") params.set("next", next);
  return `/login?${params.toString()}`;
}

// A 52px pill sunk into the sheet (DESIGN.md — Search Field / form controls):
// the sunken ground, a load-bearing hairline, copper on focus. The 16px size
// is deliberate — anything smaller makes iOS zoom the page on focus.
const inputClassName =
  "min-h-11 h-[52px] rounded-pill border border-rule-strong bg-surface-sunken px-md text-[16px] text-ink outline-none transition-colors placeholder:text-grey focus-visible:border-accent focus-ring";
const choiceClassName =
  "inline-flex min-h-11 flex-1 items-center justify-center rounded-pill px-sm text-center text-control font-medium outline-none transition-colors focus-ring";
const textLinkClassName =
  "inline-flex min-h-11 items-center justify-center rounded-pill px-sm text-center text-control text-accent outline-none transition-colors hover:text-ink focus-ring";
const fieldLabelClassName =
  "text-caption font-medium uppercase tracking-[0.18em] text-grey";

function EmailField({ error }: { error?: string }) {
  return (
    <label htmlFor="login-email" className="flex flex-col gap-xs">
      <span className={fieldLabelClassName}>Work email</span>
      <input
        id="login-email"
        type="email"
        name="email"
        autoComplete="email"
        inputMode="email"
        required
        aria-describedby={error ? "login-error" : undefined}
        placeholder="you@restaurant.com…"
        className={inputClassName}
      />
    </label>
  );
}

function PasswordFields({
  error,
  confirmation = false,
}: {
  error?: string;
  confirmation?: boolean;
}) {
  return (
    <>
      <label htmlFor="login-password" className="flex flex-col gap-xs">
        <span className={fieldLabelClassName}>Password</span>
        <input
          id="login-password"
          type="password"
          name="password"
          autoComplete={confirmation ? "new-password" : "current-password"}
          required
          minLength={6}
          maxLength={256}
          aria-describedby={error ? "login-error" : undefined}
          placeholder="At least 6 characters"
          className={inputClassName}
        />
      </label>
      {confirmation && (
        <label
          htmlFor="login-password-confirm"
          className="flex flex-col gap-xs"
        >
          <span className={fieldLabelClassName}>Confirm password</span>
          <input
            id="login-password-confirm"
            type="password"
            name="confirm"
            autoComplete="new-password"
            required
            minLength={6}
            maxLength={256}
            aria-describedby={error ? "login-error" : undefined}
            placeholder="Enter the same password"
            className={inputClassName}
          />
        </label>
      )}
    </>
  );
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const {
    error: errorCode,
    mode,
    next,
    forgot,
    sent,
    signup,
    reset,
    reset_done,
  } = await searchParams;
  const safePostLoginPath = safeNext(next, "/");
  const error = authErrorMessage(errorCode);
  const isForgotPassword = forgot === "1";
  const loginMode: LoginMode =
    mode === "password" || mode === "signup" ? mode : "magic";
  const devBypassEmail =
    process.env.NODE_ENV !== "production"
      ? process.env.DEV_BYPASS_EMAIL
      : undefined;

  const title = isForgotPassword
    ? "Reset your password"
    : loginMode === "signup"
      ? "Create your account"
      : loginMode === "password"
        ? "Sign in with password"
        : "Sign in";
  const description = isForgotPassword
    ? "We’ll email you a secure reset link."
    : loginMode === "signup"
      ? "Use your work email and choose a password."
      : loginMode === "password"
        ? "Use your work email and password."
        : "We’ll email you a secure, one-time magic link.";

  return (
    <AuthShell eyebrow="Cellar access" title={title} description={description}>
      {!isForgotPassword &&
        sent !== "1" &&
        signup !== "1" &&
        reset !== "1" &&
        reset_done !== "1" && (
          <nav
            aria-label="Sign-in method"
            className="glass mb-lg flex gap-2xs rounded-pill p-3xs"
          >
            {([
              ["magic", "Magic link"],
              ["password", "Password"],
              ["signup", "Sign up"],
            ] as const).map(([value, label]) => (
              <a
                key={value}
                href={loginHref(value, safePostLoginPath)}
                aria-current={loginMode === value ? "page" : undefined}
                className={`${choiceClassName} ${
                  loginMode === value
                    ? "bg-primary text-seal-ink"
                    : "text-grey hover:text-ink"
                }`}
              >
                {label}
              </a>
            ))}
          </nav>
        )}

      {reset_done === "1" ? (
        <StatusMessage>
          Password updated. Sign in with your new password or a magic link.
        </StatusMessage>
      ) : sent === "1" ? (
        <StatusMessage>Check your inbox for a sign-in link.</StatusMessage>
      ) : signup === "1" ? (
        <StatusMessage>
          Check your inbox to continue creating your account.
        </StatusMessage>
      ) : reset === "1" ? (
        <StatusMessage>
          If that email is registered, we’ve sent a password reset link.
        </StatusMessage>
      ) : isForgotPassword ? (
        <form action={sendPasswordReset} className="flex flex-col gap-md">
          <EmailField error={error} />
          <ErrorMessage error={error} />
          <ResetPasswordSubmit />
          <a
            href={loginHref("magic", safePostLoginPath)}
            className={textLinkClassName}
          >
            Back to sign in
          </a>
        </form>
      ) : loginMode === "password" ? (
        <form action={signInWithPassword} className="flex flex-col gap-md">
          <input type="hidden" name="next" value={safePostLoginPath} />
          <EmailField error={error} />
          <PasswordFields error={error} />
          <ErrorMessage error={error} />
          <PasswordSubmit label="Sign in" />
          <a href="/login?forgot=1" className={textLinkClassName}>
            Forgot password?
          </a>
          <a
            href={loginHref("magic", safePostLoginPath)}
            className={textLinkClassName}
          >
            Sign in with a magic link
          </a>
        </form>
      ) : loginMode === "signup" ? (
        <form action={signUpWithPassword} className="flex flex-col gap-md">
          <input type="hidden" name="next" value={safePostLoginPath} />
          <EmailField error={error} />
          <PasswordFields error={error} confirmation />
          <ErrorMessage error={error} />
          <PasswordSubmit label="Create account" />
          <a
            href={loginHref("password", safePostLoginPath)}
            className={textLinkClassName}
          >
            Already have an account? Sign in
          </a>
        </form>
      ) : (
        <form action={sendMagicLink} className="flex flex-col gap-md">
          <input type="hidden" name="next" value={safePostLoginPath} />
          <EmailField error={error} />
          <ErrorMessage error={error} />
          <MagicLinkSubmit />
          <a href="/login?forgot=1" className={textLinkClassName}>
            Forgot password?
          </a>
          <a
            href={loginHref("password", safePostLoginPath)}
            className={textLinkClassName}
          >
            Sign in with password
          </a>
          <a
            href={loginHref("signup", safePostLoginPath)}
            className={textLinkClassName}
          >
            Create an account
          </a>
        </form>
      )}

      {devBypassEmail &&
        !sent &&
        !signup &&
        reset !== "1" &&
        reset_done !== "1" && (
          <div className="mt-lg border-t border-rule pt-md">
            <p className="text-caption font-medium uppercase tracking-[0.18em] text-grey">
              Dev only
            </p>
            <a
              href="/api/dev-login"
              className="mt-xs flex min-h-11 items-center justify-center rounded-pill border border-rule-strong px-md text-center text-ledger font-medium text-ink outline-none transition-colors hover:border-accent hover:text-accent focus-ring"
            >
              Sign in as {devBypassEmail}
            </a>
            <p className="mt-xs text-ledger text-grey">
              Skips email. Disabled in production.
            </p>
          </div>
        )}
    </AuthShell>
  );
}

function ErrorMessage({ error }: { error?: string }) {
  return error ? (
    <div
      id="login-error"
      role="alert"
      aria-live="assertive"
      className="rounded-card border border-risk-ink/30 bg-risk-wash p-md text-body-sm text-risk-ink"
    >
      {error}
    </div>
  ) : null;
}

function StatusMessage({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-card border border-ready-ink/30 bg-ready-wash p-lg text-body-sm text-ready-ink"
    >
      {children}
      <a href="/login" className={`${textLinkClassName} mt-md w-full`}>
        Return to sign in
      </a>
    </div>
  );
}
