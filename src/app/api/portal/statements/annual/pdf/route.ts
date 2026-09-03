import { getPortalContext } from "@/merchant-portal/access";
import { HttpError, apiError } from "@/sentinel/http";
import { annualSummaryPdf } from "@/statements/annual";
import { listMerchantStatements } from "@/statements/data";
import { getServerEnv } from "@/sentinel/config";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const { merchant } = await getPortalContext();
    if (!merchant) throw new HttpError(404, "Merchant not found");
    const query = new URL(request.url).searchParams;
    const year = Number(query.get("year")); const currency = query.get("currency")?.toUpperCase();
    if (!Number.isInteger(year) || year < 2020 || !currency) throw new HttpError(400, "Invalid annual summary selection");
    const summary = (await listMerchantStatements(merchant.id, year)).summaries.find((item) => item.currency === currency);
    if (!summary) throw new HttpError(404, "Annual summary not found");
    const pdf = await annualSummaryPdf(summary, year, merchant.businessName, getServerEnv().STATEMENT_TIMEZONE);
    return new Response(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="ORBIT-${year}-${currency}-annual-summary.pdf"`, "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
