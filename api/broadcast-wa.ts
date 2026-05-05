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

type WhatsAppOrder = {
  id?: string;
  phone?: string;
  name?: string;
  status?: string;
};

type WhatsAppResult = {
  orderId: string;
  phone: string;
  status: "sent" | "mocked" | "skipped" | "failed";
  reason?: string;
  detail?: string;
  requestId?: number | string;
};

type FonnteResult = {
  status?: boolean;
  Status?: boolean;
  reason?: string;
  detail?: string;
  requestid?: number | string;
};

const FIREBASE_API_KEY = process.env.VITE_FIREBASE_API_KEY || "AIzaSyDsCeRM4fE0c-H7jba3eQrb7jTkf4HWkrM";
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || process.env.VITE_ADMIN_EMAILS || "rehanalay9@gmail.com")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

const getBody = <T = Record<string, unknown>>(body: unknown): T => {
  if (typeof body === "string") return JSON.parse(body) as T;
  return (body || {}) as T;
};

const requireAdmin = async (req: ApiRequest, res: ApiResponse) => {
  const authorization = req.headers.authorization;
  const header = Array.isArray(authorization) ? authorization[0] : authorization;
  const idToken = header?.replace(/^Bearer\s+/i, "");

  if (!idToken) {
    res.status(401).json({ error: "Missing Firebase admin token" });
    return false;
  }

  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  const result = await response.json();
  const email = result.users?.[0]?.email;

  if (response.ok && email && ADMIN_EMAILS.includes(String(email).toLowerCase())) {
    return true;
  }

  res.status(403).json({ error: "Only admin can send WhatsApp messages" });
  return false;
};

const normalizePhone = (phone: string) => {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("62")) return digits;
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  return digits;
};

const buildStatusMessage = (order: WhatsAppOrder) => {
  const orderCode = order.id ? order.id.slice(-6).toUpperCase() : "N/A";
  const status = order.status || "pending";
  return `Halo ${order.name || "Pelanggan"}!\n\nStatus pesanan KOMITS 2025 Anda (ID: ${orderCode}) saat ini: *${status.toUpperCase()}*.\n\nTerima kasih sudah melakukan preorder.`;
};

const sendWA = async (phone: string, message: string): Promise<Omit<WhatsAppResult, "orderId">> => {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    return { phone, status: "skipped", reason: "Nomor WhatsApp kosong/tidak valid" };
  }

  const apiKey = process.env.WHATSAPP_API_KEY;
  if (!apiKey) {
    return { phone: normalizedPhone, status: "mocked" };
  }

  const response = await fetch("https://api.fonnte.com/send", {
    method: "POST",
    headers: { Authorization: apiKey },
    body: new URLSearchParams({
      target: normalizedPhone,
      message,
      countryCode: "62",
      connectOnly: "true",
    }),
  });

  const rawResult = await response.text();
  let fonnteResult: FonnteResult = {};
  try {
    fonnteResult = JSON.parse(rawResult);
  } catch {
    fonnteResult = { detail: rawResult };
  }

  if (!response.ok || fonnteResult.status === false || fonnteResult.Status === false) {
    return {
      phone: normalizedPhone,
      status: "failed",
      reason: fonnteResult.reason || fonnteResult.detail || response.statusText || "Fonnte menolak request",
      detail: rawResult,
      requestId: fonnteResult.requestid,
    };
  }

  return {
    phone: normalizedPhone,
    status: "sent",
    reason: fonnteResult.detail || "Pesan masuk antrean Fonnte",
    detail: rawResult,
    requestId: fonnteResult.requestid,
  };
};

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
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
    console.error("broadcast-wa API error:", error);
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}
