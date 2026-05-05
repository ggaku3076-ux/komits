type ApiRequest = {
  method?: string;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
};

export const config = {
  runtime: "nodejs",
};

export default function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  return res.status(200).json({
    ok: true,
    hasWhatsAppKey: Boolean(process.env.WHATSAPP_API_KEY),
    firebaseProjectId: process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || "komits-5bceb",
    adminEmails: process.env.ADMIN_EMAILS || process.env.VITE_ADMIN_EMAILS || "rehanalay9@gmail.com",
  });
}
