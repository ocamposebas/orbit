import { describe, expect, it } from "vitest";
import { hasWorkspaceWideMerchantAccess, merchantScope, portalMerchantScope } from "@/sentinel/http";

const baseSession = { user: { id: "user_client" }, organization: { id: "org_orbit" } };

describe("merchant-scoped access", () => {
  it.each(["OWNER", "ADMIN", "ANALYST"])("gives %s workspace-wide merchant visibility", (role) => {
    expect(hasWorkspaceWideMerchantAccess(role)).toBe(true);
    expect(merchantScope({ ...baseSession, role })).toEqual({ organizationId: "org_orbit" });
  });

  it.each(["REVIEWER", "VIEWER"])("limits %s to explicitly assigned merchants", (role) => {
    expect(hasWorkspaceWideMerchantAccess(role)).toBe(false);
    expect(merchantScope({ ...baseSession, role })).toEqual({
      organizationId: "org_orbit",
      accessGrants: { some: { userId: "user_client" } },
    });
  });

  it("defaults unknown roles to assigned-only access", () => {
    expect(merchantScope({ ...baseSession, role: "UNKNOWN" })).toHaveProperty("accessGrants.some.userId", "user_client");
  });

  it("keeps the owner financial portfolio workspace-wide", () => {
    expect(portalMerchantScope({ ...baseSession, role: "OWNER", portalAllMerchants: false })).toEqual({ organizationId: "org_orbit" });
  });

  it("allows an explicit all-brand financial assignment independent of role", () => {
    expect(portalMerchantScope({ ...baseSession, role: "VIEWER", portalAllMerchants: true })).toEqual({ organizationId: "org_orbit" });
  });

  it.each(["ADMIN", "ANALYST", "REVIEWER", "VIEWER"])("limits %s financial data when assigned-brand mode is selected", (role) => {
    expect(portalMerchantScope({ ...baseSession, role, portalAllMerchants: false })).toEqual({
      organizationId: "org_orbit",
      accessGrants: { some: { userId: "user_client" } },
    });
  });
});
