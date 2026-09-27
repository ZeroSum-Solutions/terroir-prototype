import type { BottleScanResult, Scan } from "@/lib/scanner/types";

export const TEST_USER_ID = "11111111-1111-4111-8111-111111111111";
export const TEST_RESTAURANT_ID = "33333333-3333-4333-8333-333333333333";

export const invoiceResult: Scan = {
  source: {
    distributor: "Test Distributor",
    invoiceNo: "INV-1",
    invoiceDate: "2026-08-20",
    parsedAt: "2026-08-20T12:00:00.000Z",
  },
  items: [
    {
      id: "item-1",
      name: "Test Wine",
      producer: "Test Producer",
      vintage: 2022,
      varietal: "Pinot Noir",
      region: "Willamette Valley",
      qty: 1,
      unitCost: 24,
      currency: "USD",
      format: "750ml",
      confidence: 0.95,
    },
  ],
  edits: {},
  quality: {
    avgConfidence: 0.95,
    lowConfidenceItems: 0,
    totalItems: 1,
    manualFallbackTriggered: false,
  },
};

export const queuedInvoiceReceipt = {
  version: 1 as const,
  kind: "invoice_scan_upload" as const,
  scanId: "11111111-1111-4111-8111-111111111111",
  status: "queued" as const,
  itemCount: 0 as const,
};

export const bottleResult: BottleScanResult = {
  candidates: [
    {
      name: "Test Pinot Noir",
      producer: "Test Producer",
      vintage: 2022,
      varietal: "Pinot Noir",
      region: "Willamette Valley",
      country: "United States",
      format: null,
      confidence: 0.95,
      lowFields: [],
      notes: null,
    },
  ],
  parsedAt: "2026-08-20T12:00:00.000Z",
};

export function navigatorWithImmediateLocks(): Navigator {
  return new Proxy(globalThis.navigator, {
    get(target, property) {
      if (property === "locks") {
        return {
          request: async <T>(
            _name: string,
            _options: LockOptions,
            callback: (lock: Lock | null) => T | PromiseLike<T>,
          ) => callback(null),
        };
      }
      return Reflect.get(target, property, target);
    },
  });
}
