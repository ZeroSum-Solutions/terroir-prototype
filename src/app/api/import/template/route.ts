import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/handler";
import { CANONICAL_HEADERS } from "@/domains/import/constants";

// The CSV import template, served as a real download instead of a
// `data:` URI `<a download>` — mobile Safari handles download on data:
// URIs unreliably and tends to navigate the tab to raw text instead,
// which is a dead end for the first thing a new importer does.
export const runtime = "nodejs";

const TEMPLATE_CSV = `${CANONICAL_HEADERS.join(",")}\nDomaine Example,Cuvee One,2020,Pinot Noir,Burgundy,France,750,,USD,6,24.50,,\n`;

export async function GET() {
  return withApiHandler(getTemplate);
}

async function getTemplate() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  return new NextResponse(TEMPLATE_CSV, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="cellar-import-template.csv"',
    },
  });
}
