"use client";

import {
  SignInButton,
  UserButton,
  useUser,
} from "@clerk/nextjs";
import Link from "next/link";

export function AuthControls() {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  if (!publishableKey) {
    return (
      <div className="auth-controls">
        <Link href="/sign-in" className="btn btn-primary btn-sm">
          Sign in or create account
        </Link>
      </div>
    );
  }

  return <ConfiguredAuthControls />;
}

function ConfiguredAuthControls() {
  const { isLoaded, isSignedIn } = useUser();

  if (!isLoaded) {
    return (
      <div className="auth-controls">
        <button type="button" className="btn btn-primary btn-sm" disabled>
          Sign in or create account
        </button>
      </div>
    );
  }

  return (
    <div className="auth-controls">
      {isSignedIn ? (
        <UserButton />
      ) : (
        <SignInButton mode="modal">
          <button type="button" className="btn btn-primary btn-sm">
            Sign in or create account
          </button>
        </SignInButton>
      )}
    </div>
  );
}
