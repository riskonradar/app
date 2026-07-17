import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtectedProductRoute = createRouteMatcher([
  "/",
  "/account(.*)",
  "/dashboard(.*)",
  "/admin(.*)",
  "/organization(.*)",
  "/fmea(.*)",
  "/systems(.*)",
  "/api/fmea(.*)",
  "/api/systems(.*)",
  "/api/knowledge(.*)",
  "/api/billing/create-payment",
  "/api/billing/customer-portal",
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
    "/admin/:path*",
    "/organization/:path*",
    "/fmea/:path*",
    "/systems/:path*",
    "/api/fmea/:path*",
    "/api/systems/:path*",
    "/api/knowledge/:path*",
    "/api/billing/create-payment",
    "/api/billing/customer-portal",
    "/api/billing/payment-status",
  ],
};
