import { buildStatusMessage, getBody, requireAdmin, sendWA } from "./_whatsapp";

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
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!(await requireAdmin(req, res))) return;

  const { phone, name, status, orderId } = getBody<{
    phone?: string;
    name?: string;
    status?: string;
    orderId?: string;
  }>(req.body);

  if (!phone || !status) {
    return res.status(400).json({ error: "Missing phone or status" });
  }

  const result = await sendWA(phone, buildStatusMessage({ id: orderId, phone, name, status }));
  res.status(200).json({ ...result, orderId: orderId || "unknown" });
}
