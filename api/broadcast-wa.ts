import { buildStatusMessage, getBody, handleApiError, requireAdmin, sendWA, WhatsAppOrder, WhatsAppResult } from "./_whatsapp";

export const config = {
  runtime: "nodejs",
};

type ApiRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
};

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    if (!(await requireAdmin(req, res))) return;

    const body = getBody<{ orders?: WhatsAppOrder[]; message?: string }>(req.body);
    const orders = Array.isArray(body.orders) ? body.orders : [];

    if (!orders.length) {
      return res.status(400).json({ error: "Tidak ada data order untuk dikirim WhatsApp" });
    }

    const results: WhatsAppResult[] = [];
    for (const order of orders) {
      const result = await sendWA(order.phone || "", body.message || buildStatusMessage(order));
      results.push({ ...result, orderId: order.id || "unknown" });
    }

    return res.status(200).json({
      status: "done",
      total: results.length,
      sent: results.filter((result) => result.status === "sent").length,
      mocked: results.filter((result) => result.status === "mocked").length,
      skipped: results.filter((result) => result.status === "skipped").length,
      failed: results.filter((result) => result.status === "failed").length,
      results,
    });
  } catch (error) {
    return handleApiError(error, res);
  }
}
