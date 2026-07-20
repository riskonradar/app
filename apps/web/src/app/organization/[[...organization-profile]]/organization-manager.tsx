"use client";

import { OrganizationList, OrganizationProfile, useOrganization } from "@clerk/nextjs";

export function OrganizationManager() {
  const { isLoaded, organization } = useOrganization();

  if (!isLoaded) {
    return <p className="notice standalone">Loading organization...</p>;
  }

  if (!organization) {
    return (
      <OrganizationList
        afterCreateOrganizationUrl="/organization"
        afterSelectOrganizationUrl="/organization"
        afterSelectPersonalUrl="/account"
        hidePersonal={false}
      />
    );
  }

  return (
    <OrganizationProfile
      path="/organization"
      routing="path"
      afterLeaveOrganizationUrl="/account"
    />
  );
}
