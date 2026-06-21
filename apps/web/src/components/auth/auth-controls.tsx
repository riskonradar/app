"use client";

import {
  SignInButton,
  SignUpButton,
  UserButton,
  useUser,
} from "@clerk/nextjs";
import Link from "next/link";

export function AuthControls() {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  if (!publishableKey) {
    return (
      <div className="auth-controls">
        <Link href="/sign-in" className="btn btn-secondary btn-sm">
          Sign in
        </Link>
        <Link href="/sign-up" className="btn btn-primary btn-sm">
          Create account
        </Link>
      </div>
    );
  }

  return <ConfiguredAuthControls />;
}

function ConfiguredAuthControls() {
  const { isSignedIn } = useUser();

  return (
    <div className="auth-controls">
      {isSignedIn ? (
        <UserButton />
      ) : (
        <>
        <SignInButton mode="modal">
          <button type="button" className="btn btn-secondary btn-sm">
            Sign in
          </button>
        </SignInButton>
        <SignUpButton mode="modal">
          <button type="button" className="btn btn-primary btn-sm">
            Create account
          </button>
        </SignUpButton>
        </>
      )}
    </div>
  );
}
