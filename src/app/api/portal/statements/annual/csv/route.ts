import { getPortalContext } from "@/merchant-portal/access";
import { HttpError, apiError } from "@/sentinel/http";
import { annualSummaryCsv } from "@/statements/annual";
import { listMerchantStatements } from "@/statements/data";
import { getServerEnv } from "@/sentinel/config";

export async function GET(request: Request) {
  try {
    const { merchant } = await getPortalContext();
    if (!merchant) throw new HttpError(404, "Merchant not found");
    const query = new URL(request.url).searchParams;
    const year = Number(query.get("year")); const currency = query.get("currency")?.toUpperCase();
    if (!Number.isInteger(year) || year < 2020 || !currency) throw new HttpError(400, "Invalid annual summary selection");
    const summary = (await listMerchantStatements(merchant.id, year)).summaries.find((item) => item.currency === currency);
    if (!summary) throw new HttpError(404, "Annual summary not found");
    return new Response(annualSummaryCsv(summary, year, getServerEnv().STATEMENT_TIMEZONE), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="ORBIT-${year}-${currency}-annual-summary.csv"`, "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
