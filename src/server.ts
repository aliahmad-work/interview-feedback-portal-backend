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
    const startTime = Date.now();
    console.log(`[Calendly Sync] Cron triggered at ${new Date().toISOString()}`);
    try {
        const { calendlyController } = await import("./controllers/calendly.controller");
        const mockReq = {} as any;
        let syncResult: any = null;
        const mockRes = {
            json: (data: any) => {
                syncResult = data;
                if (data.syncedCount > 0) {
                    console.log(`[Calendly Sync] Synced ${data.syncedCount} event(s):`, data.results?.map((r: any) => `${r.candidateEmail} (${r.action})`).join(", "));
                } else {
                    console.log(`[Calendly Sync] No events to sync`);
                }
            },
            status: (code: number) => ({
                json: (data: any) => {
                    console.error(`[Calendly Sync] Error response (${code}):`, data.message);
                }
            }),
        } as any;

        await calendlyController.syncEvents(mockReq, mockRes);
        const elapsed = Date.now() - startTime;
        console.log(`[Calendly Sync] Completed in ${elapsed}ms`);
    } catch (error: any) {
        console.error("[Calendly Sync] Cron job failed:", error.message || error);
    }
});

console.log(`[Calendly Sync] Auto-sync scheduled every ${syncInterval} minutes`);

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
