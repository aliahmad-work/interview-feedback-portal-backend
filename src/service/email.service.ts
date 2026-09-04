import nodemailer from "nodemailer";
import fs from "fs";
import path from "path";

let _transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
    if (!_transporter) {
        if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
            throw new Error(
                `Email not configured. Missing SMTP env vars: ` +
                `SMTP_HOST=${process.env.SMTP_HOST ? "set" : "MISSING"}, ` +
                `SMTP_USER=${process.env.SMTP_USER ? "set" : "MISSING"}, ` +
                `SMTP_PASS=${process.env.SMTP_PASS ? "set" : "MISSING"}`
            );
        }
        if (process.env.SMTP_HOST && process.env.SMTP_HOST !== "smtp.gmail.com") {
            _transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST,
                port: Number(process.env.SMTP_PORT) || 587,
                secure: Number(process.env.SMTP_PORT) === 465,
                auth: {
                    user: process.env.SMTP_USER,
                    pass: process.env.SMTP_PASS,
                },
            });
            console.log(`[Email] Transporter initialized: ${process.env.SMTP_HOST}:${process.env.SMTP_PORT}`);
        } else {
            _transporter = nodemailer.createTransport({
                service: "gmail",
                auth: {
                    user: process.env.SMTP_USER,
                    pass: process.env.SMTP_PASS,
                },
            });
            console.log(`[Email] Transporter initialized for ${process.env.SMTP_USER} (service: gmail)`);
        }
    }
    return _transporter;
}

function loadTemplate(templateName: string): string {
    const templatePath = path.join(__dirname, "..", "templates", templateName);
    return fs.readFileSync(templatePath, "utf-8");
}

function replaceTemplateVars(template: string, vars: Record<string, string>): string {
    let result = template;
    for (const [key, value] of Object.entries(vars)) {
        result = result.replace(new RegExp(`{{${key}}}`, "g"), value);
    }
    return result;
}

async function sendEmail(to: string, subject: string, html: string) {
    const transporter = getTransporter();

    console.log(`[Email] Sending to: ${to}`);
    console.log(`[Email] Subject: ${subject}`);
    console.log(`[Email] From: ${process.env.SMTP_USER}`);

    try {
        const info = await transporter.sendMail({
            from: process.env.SMTP_USER,
            to,
            subject,
            html,
            headers: {
                "X-Mailer": "Interview-Portal",
                "X-Priority": "3",
            },
        });

        console.log(`[Email] SUCCESS - MessageID: ${info.messageId}`);
        console.log(`[Email] Envelope: ${JSON.stringify(info.envelope)}`);
        console.log(`[Email] Response: ${info.response}`);

        return info;
    } catch (error: any) {
        console.error(`[Email] FAILED to send to ${to}`);
        console.error(`[Email] Error code: ${error.code}`);
        console.error(`[Email] Error command: ${error.command}`);
        console.error(`[Email] Error response: ${error.response}`);
        console.error(`[Email] Error message: ${error.message}`);
        console.error(`[Email] Full error:`, error);
        throw error;
    }
}

export const emailService = {
    async sendScheduleToCandidate(params: {
        candidateEmail: string;
        candidateName: string;
        positionName: string;
        roundNumber: number;
        schedulingUrl: string;
    }) {
        const template = loadTemplate("schedule-candidate.html");
        const html = replaceTemplateVars(template, {
            candidateName: params.candidateName,
            positionName: params.positionName,
            roundNumber: String(params.roundNumber),
            schedulingUrl: params.schedulingUrl,
        });

        return sendEmail(
            params.candidateEmail,
            `Please select your interview time - ${params.positionName}`,
            html
        );
    },

    async sendConfirmationToInterviewer(params: {
        interviewerEmail: string;
        interviewerName: string;
        candidateName: string;
        positionName: string;
        date: string;
        time: string;
        duration: number;
        roundNumber: number;
        rescheduleUrl?: string;
        meetingUrl?: string;
    }) {
        const template = loadTemplate("confirmation-interviewer.html");
        const meetingLinkSection = params.meetingUrl
            ? `<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;margin:0 0 25px;">
                <tr>
                    <td style="padding:16px 20px;">
                        <p style="margin:0 0 10px;font-size:14px;font-weight:600;color:#1e40af;">Google Meet / Meeting Link:</p>
                        <table cellpadding="0" cellspacing="0" style="margin:0 0 10px;">
                            <tr>
                                <td style="background-color:#2563eb;border-radius:6px;">
                                    <a href="${params.meetingUrl}" target="_blank" style="display:inline-block;padding:12px 24px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">Join Google Meet</a>
                                </td>
                            </tr>
                        </table>
                        <p style="margin:0;font-size:12px;color:#6b7280;word-break:break-all;">Direct Link: <a href="${params.meetingUrl}" target="_blank" style="color:#2563eb;text-decoration:underline;">${params.meetingUrl}</a></p>
                    </td>
                </tr>
              </table>`
            : "";
        const rescheduleButtonHtml = params.rescheduleUrl
            ? `<table cellpadding="0" cellspacing="0" style="margin:0 0 10px;">
                <tr>
                    <td style="background-color:#4f46e5;border-radius:6px;">
                        <a href="${params.rescheduleUrl}" target="_blank" style="display:inline-block;padding:12px 24px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">Reschedule Interview</a>
                    </td>
                </tr>
              </table>
              <p style="color:#9ca3af;margin:0;font-size:12px;">Use this link to select a new date and time for this interview.</p>`
            : `<p style="color:#6b7280;margin:0;font-size:13px;">If you need to reschedule, please contact the admin.</p>`;
        const html = replaceTemplateVars(template, {
            interviewerName: params.interviewerName,
            candidateName: params.candidateName,
            positionName: params.positionName,
            date: params.date,
            time: params.time,
            duration: String(params.duration),
            roundNumber: String(params.roundNumber),
            rescheduleUrl: rescheduleButtonHtml,
            meetingLinkSection,
        });

        return sendEmail(
            params.interviewerEmail,
            `Interview Scheduled - ${params.positionName} | ${params.date} at ${params.time}`,
            html
        );
    },

    async sendConfirmationToAdmin(params: {
        adminEmail: string;
        adminName: string;
        candidateName: string;
        positionName: string;
        date: string;
        time: string;
        duration: number;
        roundNumber: number;
        interviewerNames: string;
        meetingUrl?: string;
    }) {
        const template = loadTemplate("confirmation-admin.html");
        const meetingLinkRow = params.meetingUrl
            ? `<tr>
                <td style="padding:8px 0;color:#374151;font-size:14px;font-weight:600;">Meeting Link:</td>
                <td style="padding:8px 0;color:#1f2937;font-size:14px;">
                    <a href="${params.meetingUrl}" target="_blank" style="color:#2563eb;font-weight:600;text-decoration:underline;">Join Meeting</a>
                    <span style="color:#6b7280;font-size:12px;display:block;word-break:break-all;">(${params.meetingUrl})</span>
                </td>
               </tr>`
            : "";
        const html = replaceTemplateVars(template, {
            adminName: params.adminName,
            candidateName: params.candidateName,
            positionName: params.positionName,
            date: params.date,
            time: params.time,
            duration: String(params.duration),
            roundNumber: String(params.roundNumber),
            interviewerNames: params.interviewerNames,
            meetingLinkRow,
        });

        return sendEmail(
            params.adminEmail,
            `Interview Scheduled - ${params.positionName} | ${params.date} at ${params.time}`,
            html
        );
    },

    async sendConfirmationToCandidate(params: {
        candidateEmail: string;
        candidateName: string;
        positionName: string;
        date: string;
        time: string;
        duration: number;
        roundNumber: number;
        meetingUrl?: string;
    }) {
        const template = loadTemplate("confirmation-candidate.html");
        const meetingLinkSection = params.meetingUrl
            ? `<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;margin:0 0 25px;">
                <tr>
                    <td style="padding:16px 20px;">
                        <p style="margin:0 0 10px;font-size:14px;font-weight:600;color:#1e40af;">Google Meet / Meeting Link:</p>
                        <table cellpadding="0" cellspacing="0" style="margin:0 0 10px;">
                            <tr>
                                <td style="background-color:#7c3aed;border-radius:6px;">
                                    <a href="${params.meetingUrl}" target="_blank" style="display:inline-block;padding:12px 24px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">Join Google Meet</a>
                                </td>
                            </tr>
                        </table>
                        <p style="margin:0;font-size:12px;color:#6b7280;word-break:break-all;">Direct Link: <a href="${params.meetingUrl}" target="_blank" style="color:#7c3aed;text-decoration:underline;">${params.meetingUrl}</a></p>
                    </td>
                </tr>
              </table>`
            : "";
        const html = replaceTemplateVars(template, {
            candidateName: params.candidateName,
            positionName: params.positionName,
            date: params.date,
            time: params.time,
            duration: String(params.duration),
            roundNumber: String(params.roundNumber),
            meetingLinkSection,
        });

        return sendEmail(
            params.candidateEmail,
            `Interview Confirmed - ${params.positionName} | ${params.date} at ${params.time}`,
            html
        );
    },

    async sendRescheduleNotification(params: {
        recipientEmail: string;
        recipientName: string;
        candidateName: string;
        positionName: string;
        oldDate: string;
        oldTime: string;
        newDate: string;
        newTime: string;
        roundNumber: number;
        rescheduleUrl?: string;
        meetingUrl?: string;
    }) {
        const template = loadTemplate("reschedule-notification.html");
        const meetingLinkSection = params.meetingUrl
            ? `<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;margin:0 0 25px;">
                <tr>
                    <td style="padding:16px 20px;">
                        <p style="margin:0 0 10px;font-size:14px;font-weight:600;color:#1e40af;">Updated Google Meet / Meeting Link:</p>
                        <table cellpadding="0" cellspacing="0" style="margin:0 0 10px;">
                            <tr>
                                <td style="background-color:#2563eb;border-radius:6px;">
                                    <a href="${params.meetingUrl}" target="_blank" style="display:inline-block;padding:12px 24px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">Join Google Meet</a>
                                </td>
                            </tr>
                        </table>
                        <p style="margin:0;font-size:12px;color:#6b7280;word-break:break-all;">Direct Link: <a href="${params.meetingUrl}" target="_blank" style="color:#2563eb;text-decoration:underline;">${params.meetingUrl}</a></p>
                    </td>
                </tr>
              </table>`
            : "";
        const rescheduleButtonHtml = params.rescheduleUrl
            ? `<table cellpadding="0" cellspacing="0" style="margin:0 0 10px;">
                <tr>
                    <td style="background-color:#d97706;border-radius:6px;">
                        <a href="${params.rescheduleUrl}" target="_blank" style="display:inline-block;padding:12px 24px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">Reschedule Interview</a>
                    </td>
                </tr>
              </table>
              <p style="color:#9ca3af;margin:0;font-size:12px;">Use this link to select a new date and time for this interview.</p>`
            : `<p style="color:#6b7280;margin:0;font-size:13px;">If you need to reschedule, please contact the admin.</p>`;
        const html = replaceTemplateVars(template, {
            recipientName: params.recipientName,
            candidateName: params.candidateName,
            positionName: params.positionName,
            oldDate: params.oldDate,
            oldTime: params.oldTime,
            newDate: params.newDate,
            newTime: params.newTime,
            roundNumber: String(params.roundNumber),
            rescheduleUrl: rescheduleButtonHtml,
            meetingLinkSection,
        });

        return sendEmail(
            params.recipientEmail,
            `Interview Rescheduled - ${params.positionName} | New: ${params.newDate} at ${params.newTime}`,
            html
        );
    },

    async sendTestEmail(to: string) {
        const html = `
<!DOCTYPE html>
<html>
<body style="font-family:Arial,sans-serif;padding:20px;">
    <h2 style="color:#4f46e5;">Email Test - Interview Portal</h2>
    <p>This is a test email from the Interview Portal backend.</p>
    <p>If you received this, SMTP is configured correctly.</p>
    <p style="color:#6b7280;font-size:12px;">Sent at: ${new Date().toISOString()}</p>
</body>
</html>`;

        return sendEmail(to, "Interview Portal - Email Test", html);
    },

    async verifyConnection(): Promise<boolean> {
        try {
            const transporter = getTransporter();
            await transporter.verify();
            console.log("[Email] SMTP connection verified successfully");
            return true;
        } catch (error: any) {
            console.error("[Email] SMTP connection failed:", error.message);
            return false;
        }
    },
};
