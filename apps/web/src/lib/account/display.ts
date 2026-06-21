export type LocalMembership = {
  status?: string;
};

export function maskEmail(email: string | null | undefined) {
  if (!email) return "Signed in";
  const [name = "", domain = ""] = email.split("@");
  if (!domain) return email.length > 6 ? `${email.slice(0, 3)}...${email.slice(-2)}` : email;
  const visibleName = name.length <= 3 ? name : `${name.slice(0, 3)}...${name.slice(-2)}`;
  const [domainName = "", ...domainRest] = domain.split(".");
  const visibleDomain = domainName.length <= 1 ? domainName : `${domainName[0]}...`;
  return `${visibleName}@${visibleDomain}${domainRest.length ? `.${domainRest.at(-1)}` : ""}`;
}

export function parseLocalMembership(snapshot: string | null) {
  if (!snapshot) return null;
  try {
    return JSON.parse(snapshot) as LocalMembership;
  } catch {
    return null;
  }
}

export function resolvePlanDisplay({
  localMembership,
  serverPlan,
  serverStatus,
}: {
  localMembership: LocalMembership | null;
  serverPlan?: string | null;
  serverStatus?: string | null;
}) {
  const isPro = serverStatus === "active" || localMembership?.status === "paid";
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
    label: serverPlan === "individual" ? "Individual plan" : "Free tier",
    name: serverPlan === "individual" ? "Individual" : "Free",
    status: serverStatus ?? "Free",
  };
}
