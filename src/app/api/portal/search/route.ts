import { NextResponse, type NextRequest } from "next/server";
import { getPortalContext } from "@/merchant-portal/access";
import { globalPortalSearch } from "@/operations/search";
import { customerMerchantIds } from "@/customers/data";

export async function GET(request: NextRequest) {
  const { merchant, merchants, session } = await getPortalContext();
  const query = request.nextUrl.searchParams.get("q") ?? "";
  const scope = customerMerchantIds(session.role, merchant?.id ?? null, merchants.map((item) => item.id));
  const results = await globalPortalSearch(scope, query);
  return NextResponse.json({ results }, { headers: { "Cache-Control": "private, no-store" } });
}
