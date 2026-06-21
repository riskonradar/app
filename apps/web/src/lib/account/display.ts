export function maskEmail(email: string | null | undefined) {
  if (!email) return "Signed in";
  const [name = "", domain = ""] = email.split("@");
  if (!domain) return email.length > 6 ? `${email.slice(0, 3)}...${email.slice(-2)}` : email;
  const visibleName = name.length <= 3 ? name : `${name.slice(0, 3)}...${name.slice(-2)}`;
  const [domainName = "", ...domainRest] = domain.split(".");
  const visibleDomain = domainName.length <= 1 ? domainName : `${domainName[0]}...`;
  return `${visibleName}@${visibleDomain}${domainRest.length ? `.${domainRest.at(-1)}` : ""}`;
}

export function resolvePlanDisplay({
  serverPlan,
  serverStatus,
}: {
  serverPlan?: string | null;
  serverStatus?: string | null;
}) {
  const isPro = serverStatus === "active" || serverStatus === "comped";
  if (isPro) {
    return {
      detail: "Unlimited Failure Mode and Effects Analysis tables are available.",
      label: "Pro member",
      name: "Pro",
      status: "Active",
    };
  }

  return {
    detail: "Free tier includes 1 saved Failure Mode and Effects Analysis table.",
    label: serverPlan === "individual" ? "Free tier" : "Free tier",
    name: "Free",
    status: serverStatus ?? "Free",
  };
}
