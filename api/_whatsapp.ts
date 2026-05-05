const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || "komits-5bceb";
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || process.env.VITE_ADMIN_EMAILS || "rehanalay9@gmail.com")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

export type WhatsAppOrder = {
  id?: string;
  phone?: string;
  name?: string;
  status?: string;
};

export type WhatsAppResult = {
  orderId: string;
  phone: string;
  status: "sent" | "mocked" | "skipped" | "failed";
  reason?: string;
  detail?: string;
  requestId?: number | string;
};

type ApiRequest = {
  headers: Record<string, string | string[] | undefined>;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
};

export const normalizePhone = (phone: string) => {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("62")) return digits;
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  return digits;
};

export const buildStatusMessage = (order: WhatsAppOrder) => {
  const orderCode = order.id ? order.id.slice(-6).toUpperCase() : "N/A";
  const status = order.status || "pending";
  return `Halo ${order.name || "Pelanggan"}!\n\nStatus pesanan KOMITS 2025 Anda (ID: ${orderCode}) saat ini: *${status.toUpperCase()}*.\n\nTerima kasih sudah melakukan preorder.`;
};

export const getBody = <T = Record<string, unknown>>(body: unknown): T => {
  if (typeof body === "string") {
    return JSON.parse(body) as T;
  }
  return (body || {}) as T;
};

const getTokenPayload = (token: string) => {
  try {
    const [, payload] = token.split(".");
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
    return JSON.parse(Buffer.from(normalized + padding, "base64").toString("utf8")) as {
      aud?: string;
      email?: string;
    };
  } catch {
    return null;
  }
};

export const requireAdmin = async (req: ApiRequest, res: ApiResponse) => {
  const authorization = req.headers.authorization;
  const header = Array.isArray(authorization) ? authorization[0] : authorization;
  const token = header?.replace(/^Bearer\s+/i, "");

  if (!token) {
    res.status(401).json({ error: "Missing Firebase admin token" });
    return false;
  }

  const payload = getTokenPayload(token);
  if (
    payload?.aud === FIREBASE_PROJECT_ID &&
    payload.email &&
    ADMIN_EMAILS.includes(payload.email.toLowerCase())
  ) {
    return true;
  }

  res.status(403).json({ error: "Only admin can send WhatsApp messages" });
  return false;
};

export const handleApiError = (error: unknown, res: ApiResponse) => {
  console.error("API route error:", error);
  res.status(500).json({
    error: error instanceof Error ? error.message : String(error),
  });
};

export const sendWA = async (phone: string, message: string): Promise<WhatsAppResult> => {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    return { orderId: "unknown", phone, status: "skipped", reason: "Nomor WhatsApp kosong/tidak valid" };
  }

  const apiKey = process.env.WHATSAPP_API_KEY;
  if (!apiKey) {
    console.log(`[WA MOCK to ${normalizedPhone}]: ${message}`);
    return { orderId: "unknown", phone: normalizedPhone, status: "mocked" };
  }

  try {
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
    let fonnteResult: {
      status?: boolean;
      Status?: boolean;
      reason?: string;
      detail?: string;
      requestid?: number | string;
    } = {};

    try {
      fonnteResult = JSON.parse(rawResult);
    } catch {
      fonnteResult = { detail: rawResult };
    }

    if (!response.ok || fonnteResult.status === false || fonnteResult.Status === false) {
      return {
        orderId: "unknown",
        phone: normalizedPhone,
        status: "failed",
        reason: fonnteResult.reason || fonnteResult.detail || response.statusText || "Fonnte menolak request",
        detail: rawResult,
        requestId: fonnteResult.requestid,
      };
    }

    return {
      orderId: "unknown",
      phone: normalizedPhone,
      status: "sent",
      reason: fonnteResult.detail || "Pesan masuk antrean Fonnte",
      detail: rawResult,
      requestId: fonnteResult.requestid,
    };
  } catch (error) {
    console.error("WA Send Error:", error);
    return {
      orderId: "unknown",
      phone: normalizedPhone,
      status: "failed",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
};
