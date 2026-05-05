import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import admin from "firebase-admin";

dotenv.config({ path: ".env.local" });
dotenv.config();

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || "komits-5bceb";

if (!admin.apps.length) {
  try {
    admin.initializeApp({ projectId: FIREBASE_PROJECT_ID });
  } catch (error) {
    console.warn("Firebase Admin failed to initialize. Check service account env vars.");
  }
}

const db = admin.apps.length ? admin.firestore() : null;
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || process.env.VITE_ADMIN_EMAILS || "rehanalay9@gmail.com")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

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

const getDevTokenPayload = (token: string) => {
  try {
    const [, payload] = token.split(".");
    if (!payload) return null;
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      aud?: string;
      email?: string;
    };
  } catch {
    return null;
  }
};

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  const requireAdmin = async (req: express.Request, res: express.Response) => {
    const apiKey = process.env.WHATSAPP_API_KEY;
    if (!apiKey) return true;

    const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!token) {
      res.status(401).json({ error: "Missing Firebase admin token" });
      return false;
    }

    try {
      const decoded = await admin.auth().verifyIdToken(token);
      if (decoded.email && ADMIN_EMAILS.includes(decoded.email.toLowerCase())) {
        return true;
      }
      res.status(403).json({ error: "Only admin can send WhatsApp messages" });
      return false;
    } catch (error) {
      console.error("Admin token verification failed:", error);
      const devPayload = process.env.NODE_ENV !== "production" ? getDevTokenPayload(token) : null;
      if (
        devPayload?.aud === FIREBASE_PROJECT_ID &&
        devPayload.email &&
        ADMIN_EMAILS.includes(devPayload.email.toLowerCase())
      ) {
        console.warn("Using local development Firebase token fallback for WhatsApp admin check.");
        return true;
      }
      res.status(401).json({ error: "Invalid Firebase admin token" });
      return false;
    }
  };

  const sendWA = async (phone: string, message: string): Promise<WhatsAppResult> => {
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
      const response = await fetch('https://api.fonnte.com/send', {
        method: 'POST',
        headers: { 'Authorization': apiKey },
        body: new URLSearchParams({
          target: normalizedPhone,
          message: message,
          countryCode: '62',
          connectOnly: 'true'
        })
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

      if (!response.ok) {
        return {
          orderId: "unknown",
          phone: normalizedPhone,
          status: "failed",
          reason: fonnteResult.reason || fonnteResult.detail || response.statusText,
          detail: rawResult,
          requestId: fonnteResult.requestid,
        };
      }

      if (fonnteResult.status === false || fonnteResult.Status === false) {
        return {
          orderId: "unknown",
          phone: normalizedPhone,
          status: "failed",
          reason: fonnteResult.reason || fonnteResult.detail || "Fonnte menolak request",
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
      return { orderId: "unknown", phone: normalizedPhone, status: "failed", reason: error instanceof Error ? error.message : String(error) };
    }
  };

  // API Route to sync to Google Sheet
  app.post("/api/sync-order", async (req, res) => {
    /* ... existing code ... */
    const webhookUrl = process.env.GOOGLE_SHEET_WEBHOOK_URL;
    
    if (!webhookUrl) {
      console.warn("GOOGLE_SHEET_WEBHOOK_URL is not set. Skipping sheet sync.");
      return res.status(200).json({ status: "skipped", reason: "no_webhook" });
    }

    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(req.body),
      });

      if (!response.ok) {
        throw new Error(`Failed to sync to Google Sheets: ${response.statusText}`);
      }

      res.json({ status: "success" });
    } catch (error) {
      console.error("Error syncing to Google Sheets:", error);
      res.status(500).json({ error: "Failed to sync to Google Sheets" });
    }
  });

  // API Route for WA Status Update
  app.post("/api/notify-status", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;

    const { phone, name, status, orderId } = req.body;
    if (!phone || !status) return res.status(400).json({ error: "Missing phone or status" });

    const result = await sendWA(phone, buildStatusMessage({ id: orderId, phone, name, status }));
    res.json({ ...result, orderId: orderId || "unknown" });
  });

  app.post("/api/broadcast-wa", async (req, res) => {
    if (!(await requireAdmin(req, res))) return;

    let orders = Array.isArray(req.body.orders) ? req.body.orders as WhatsAppOrder[] : [];

    if (!orders.length && db) {
      try {
        const snapshot = await db.collection("orders").get();
        orders = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as WhatsAppOrder[];
      } catch (error) {
        console.error("Failed to read orders for WA broadcast:", error);
        return res.status(500).json({ error: "Failed to read orders for WA broadcast" });
      }
    }

    if (!orders.length) {
      return res.status(400).json({ error: "Tidak ada data order untuk dikirim WhatsApp" });
    }

    const results: WhatsAppResult[] = [];
    for (const order of orders) {
      const result = await sendWA(order.phone || "", req.body.message || buildStatusMessage(order));
      results.push({ ...result, orderId: order.id || "unknown" });
    }

    res.json({
      status: "done",
      total: results.length,
      sent: results.filter((result) => result.status === "sent").length,
      mocked: results.filter((result) => result.status === "mocked").length,
      skipped: results.filter((result) => result.status === "skipped").length,
      failed: results.filter((result) => result.status === "failed").length,
      results,
    });
  });

  // Background Task: Payment Reminder (Every 24 hours)
  const runReminders = async () => {
    if (!db) return;
    console.log("Checking for payment reminders...");
    try {
      const yesterday = new Date();
      yesterday.setHours(yesterday.getHours() - 24);

      const snapshot = await db.collection("orders")
        .where("status", "==", "pending")
        .where("paymentProofUrl", "==", "")
        .where("createdAt", "<=", admin.firestore.Timestamp.fromDate(yesterday))
        .get();

      for (const doc of snapshot.docs) {
        const order = doc.data();
        const message = `PENGINGAT PEMBAYARAN: Halo ${order.name}, pesanan Anda (ID: ${doc.id.slice(-6).toUpperCase()}) sudah 24 jam belum selesai pembayarannya. Silakan segera upload bukti transfer ya. Terima kasih!`;
        await sendWA(order.phone, message);
        console.log(`Reminder sent to ${order.phone}`);
      }
    } catch (error) {
      console.error("Reminder job error:", error);
    }
  };

  // Run every 4 hours to check for 24h gaps
  setInterval(runReminders, 1000 * 60 * 60 * 4);

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
