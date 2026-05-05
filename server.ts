import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import admin from "firebase-admin";

dotenv.config();

// Initialize Firebase Admin (uses environment variables automatically if set up)
// In AI Studio, we can initialize with default app if credentials are in env or we can skip for now
// and use the client SDK fetch patterns if we prefer. But admin is cleaner.
if (!admin.apps.length) {
  try {
    admin.initializeApp();
  } catch (error) {
    console.warn("Firebase Admin failed to initialize. Check service account env vars.");
  }
}

const db = admin.apps.length ? admin.firestore() : null;

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  const sendWA = async (phone: string, message: string) => {
    const apiKey = process.env.WHATSAPP_API_KEY;
    if (!apiKey) {
      console.log(`[WA MOCK to ${phone}]: ${message}`);
      return;
    }

    try {
      // Example using Fonnte (popular in ID) - Adjust for your provider
      await fetch('https://api.fonnte.com/send', {
        method: 'POST',
        headers: { 'Authorization': apiKey },
        body: new URLSearchParams({
          target: phone,
          message: message,
          countryCode: '62' // default for ID
        })
      });
    } catch (error) {
      console.error("WA Send Error:", error);
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
    const { phone, name, status, orderId } = req.body;
    if (!phone || !status) return res.status(400).json({ error: "Missing phone or status" });

    const message = `Halo ${name || 'Pelanggan'}!\n\nStatus pesanan KOMITS 2025 Anda (ID: ${orderId || 'N/A'}) telah diperbarui menjadi: *${status.toUpperCase()}*.\n\nTerima kasih atas pesanan Anda!`;
    
    await sendWA(phone, message);
    res.json({ status: "success" });
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
