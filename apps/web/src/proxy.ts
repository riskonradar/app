import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtectedProductRoute = createRouteMatcher([
  "/",
  "/account(.*)",
  "/dashboard(.*)",
  "/fmea(.*)",
  "/api/fmea(.*)",
  "/api/knowledge(.*)",
  "/api/billing/create-payment",
  "/api/billing/payment-status",
]);

export default clerkMiddleware(async (auth, request) => {
  if (isProtectedProductRoute(request)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/",
    "/account/:path*",
    "/dashboard/:path*",
    "/fmea/:path*",
    "/api/fmea/:path*",
    "/api/knowledge/:path*",
    "/api/billing/create-payment",
    "/api/billing/payment-status",
  ],
};
