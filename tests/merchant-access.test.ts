import { describe, expect, it } from "vitest";
import { hasWorkspaceWideMerchantAccess, merchantScope } from "@/sentinel/http";

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
});
