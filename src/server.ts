require("dotenv").config();

import cron from "node-cron";
import app from "./app";

const PORT = process.env.PORT || 3000;

// Verify email configuration on startup
async function verifyEmailConfig() {
    try {
        const { emailService } = await import("./service/email.service");
        const ok = await emailService.verifyConnection();
        if (!ok) {
            console.warn("[Startup] WARNING: Email is NOT configured. Emails will fail.");
            console.warn("[Startup] Set SMTP_HOST, SMTP_USER, SMTP_PASS in .env");
        }
    } catch (error: any) {
        console.error("[Startup] Email verification failed:", error.message);
    }
}
verifyEmailConfig();

// Calendly auto-sync cron job
const syncInterval = Number(process.env.CALENDLY_SYNC_INTERVAL_MINUTES) || 5;
const cronExpression = `*/${syncInterval} * * * *`;

cron.schedule(cronExpression, async () => {
    try {
        const { calendlyController } = await import("./controllers/calendly.controller");
        const mockReq = {} as any;
        const mockRes = {
            json: (data: any) => {
                if (data.syncedCount > 0) {
                    console.log(`[Calendly Sync] Synced ${data.syncedCount} events`);
                }
            },
            status: () => ({ json: () => {} }),
        } as any;

        await calendlyController.syncEvents(mockReq, mockRes);
    } catch (error) {
        console.error("[Calendly Sync] Cron job failed:", error);
    }
});

console.log(`[Calendly Sync] Auto-sync scheduled every ${syncInterval} minutes`);

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
