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

export interface ResumeAttachmentInput {
    candidateFirstname: string;
    candidateLastname: string;
    resumeData?: Buffer | Uint8Array | null;
    resumeMimeType?: string | null;
}

export function buildResumeAttachment(resume: ResumeAttachmentInput): EmailAttachment | undefined {
    if (!resume.resumeData) {
        return undefined;
    }

    const mimeType = resume.resumeMimeType || "application/octet-stream";
    const ext =
        mimeType === "application/pdf"
            ? "pdf"
            : mimeType === "application/msword"
            ? "doc"
            : mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            ? "docx"
            : "pdf";

    const content = resume.resumeData instanceof Uint8Array
        ? Buffer.from(resume.resumeData)
        : Buffer.from(resume.resumeData);

    return {
        filename: `${resume.candidateFirstname}_${resume.candidateLastname}_resume.${ext}`,
        content,
        contentType: mimeType,
    };
}

export interface EmailAttachment {
    filename: string;
    content: Buffer | string;
    contentType?: string;
}

async function sendEmail(to: string, subject: string, html: string, attachments?: EmailAttachment[]) {
    const transporter = getTransporter();

    console.log(`[Email] Sending to: ${to}`);
    console.log(`[Email] Subject: ${subject}`);
    console.log(`[Email] From: ${process.env.SMTP_USER}`);
    if (attachments && attachments.length > 0) {
        console.log(`[Email] Attachments: ${attachments.map((a) => a.filename).join(", ")}`);
    }

    try {
        const info = await transporter.sendMail({
            from: process.env.SMTP_USER,
            to,
            subject,
            html,
            ...(attachments && attachments.length > 0 ? { attachments } : {}),
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

    async sendCandidateHired(params: {
        candidateEmail: string;
        candidateName: string;
        positionName: string;
    }) {
        const template = loadTemplate("decision-hired-candidate.html");
        const html = replaceTemplateVars(template, {
            candidateName: params.candidateName,
            positionName: params.positionName,
        });

        return sendEmail(
            params.candidateEmail,
            `Congratulations! Selection Notification - ${params.positionName}`,
            html
        );
    },

    async sendCandidateRejected(params: {
        candidateEmail: string;
        candidateName: string;
        positionName: string;
    }) {
        const template = loadTemplate("decision-rejected-candidate.html");
        const html = replaceTemplateVars(template, {
            candidateName: params.candidateName,
            positionName: params.positionName,
        });

        return sendEmail(
            params.candidateEmail,
            `Update regarding your application for ${params.positionName}`,
            html
        );
    },

    async sendCandidateOnHold(params: {
        candidateEmail: string;
        candidateName: string;
        positionName: string;
    }) {
        const template = loadTemplate("decision-hold-candidate.html");
        const html = replaceTemplateVars(template, {
            candidateName: params.candidateName,
            positionName: params.positionName,
        });

        return sendEmail(
            params.candidateEmail,
            `Application Status Update - ${params.positionName}`,
            html
        );
    },

    async sendCandidateInterviewResumed(params: {
        candidateEmail: string;
        candidateName: string;
        positionName: string;
        roundNumber: number;
        schedulingUrl?: string | null;
    }) {
        const template = loadTemplate("decision-resumed-candidate.html");
        const schedulingSection = params.schedulingUrl
            ? `<p style="color:#4b5563;line-height:1.6;margin:0 0 15px;font-size:14px;">
                We invite you to select a convenient date and time slot for <strong>Round ${params.roundNumber}</strong>:
               </p>
               <table width="100%" cellpadding="0" cellspacing="0" style="margin:25px 0;">
                <tr>
                    <td align="center">
                        <a href="${params.schedulingUrl}" target="_blank" style="display:inline-block;background-color:#4f46e5;color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:6px;font-size:15px;font-weight:600;">
                            Select Interview Time Slot
                        </a>
                    </td>
                </tr>
               </table>
               <p style="color:#6b7280;line-height:1.6;margin:0 0 10px;font-size:13px;">
                Please complete scheduling within <strong>48 hours</strong> to secure your slot.
               </p>`
            : `<p style="color:#4b5563;line-height:1.6;margin:0 0 15px;font-size:14px;">
                Our hiring team will be in touch with you shortly with further details and schedule for <strong>Round ${params.roundNumber}</strong>.
               </p>`;

        const html = replaceTemplateVars(template, {
            candidateName: params.candidateName,
            positionName: params.positionName,
            roundNumber: String(params.roundNumber),
            schedulingSection,
        });

        return sendEmail(
            params.candidateEmail,
            `Interview Process Resumed - ${params.positionName} (Round ${params.roundNumber})`,
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
        resume?: ResumeAttachmentInput;
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

        const attachments = params.resume
            ? [buildResumeAttachment(params.resume)].filter((a): a is EmailAttachment => !!a)
            : undefined;

        return sendEmail(
            params.interviewerEmail,
            `Interview Scheduled - ${params.positionName} | ${params.date} at ${params.time}`,
            html,
            attachments
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

    async sendFeedbackSubmittedToAdmin(params: {
        adminEmail: string;
        adminName: string;
        candidateName: string;
        positionName: string;
        roundInfo: string;
        interviewerName: string;
        rating: number;
        recommendation: string;
        positiveComments: string;
        negativeComments: string;
        additionalComments?: string;
        submittedDate: string;
        isFinalRound?: boolean;
    }) {
        const template = loadTemplate("feedback-submitted-admin.html");

        // Format recommendation badge
        const rec = params.recommendation.toLowerCase();
        let badgeBg = "#eff6ff";
        let badgeColor = "#1e40af";
        let badgeBorder = "#bfdbfe";

        if (rec.includes("strong hire") || rec === "hire" || rec.includes("hire")) {
            badgeBg = "#ecfdf5";
            badgeColor = "#065f46";
            badgeBorder = "#a7f3d0";
        } else if (rec.includes("reject") || rec.includes("no hire")) {
            badgeBg = "#fff1f2";
            badgeColor = "#9f1239";
            badgeBorder = "#fecdd3";
        } else if (rec.includes("hold")) {
            badgeBg = "#fffbeb";
            badgeColor = "#92400e";
            badgeBorder = "#fde68a";
        }

        const recommendationBadge = `<span style="display:inline-block;padding:4px 12px;background-color:${badgeBg};color:${badgeColor};border:1px solid ${badgeBorder};border-radius:9999px;font-size:13px;font-weight:600;">${params.recommendation}</span>`;

        // Format rating display with stars
        const filledStars = Math.max(0, Math.min(5, Math.round(params.rating)));
        const stars = "★".repeat(filledStars) + "☆".repeat(5 - filledStars);
        const ratingDisplay = `<span style="color:#f59e0b;font-size:16px;letter-spacing:1px;margin-right:6px;">${stars}</span><span style="font-weight:600;color:#334155;">(${params.rating}/5)</span>`;

        // Format additional comments section if present
        const additionalCommentsSection = params.additionalComments && params.additionalComments.trim()
            ? `<tr>
                <td style="padding:0;">
                    <div style="background-color:#f8fafc;border:1px solid #e2e8f0;border-left:4px solid #64748b;border-radius:4px;padding:16px;">
                        <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.5px;">Additional Notes</p>
                        <p style="margin:0;font-size:14px;color:#334155;line-height:1.6;white-space:pre-wrap;">${params.additionalComments}</p>
                    </div>
                </td>
               </tr>`
            : "";

        const isFinal = Boolean(params.isFinalRound);

        const headerBgColor = isFinal ? "#4338ca" : "#4f46e5";
        const headerTitle = isFinal
            ? "Final Interview Feedback Submitted"
            : "Interview Feedback Submitted";
        const headerSubtitle = isFinal
            ? `<div style="margin-top:8px;"><span style="display:inline-block;background-color:rgba(255,255,255,0.2);color:#ffffff;font-size:12px;font-weight:600;padding:4px 12px;border-radius:9999px;">All Rounds Completed • Final Decision Ready</span></div>`
            : "";

        const finalRoundBanner = isFinal
            ? `<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#ecfdf5;border:1px solid #6ee7b7;border-left:4px solid #059669;border-radius:6px;margin:0 0 24px;">
                <tr>
                    <td style="padding:16px 20px;">
                        <span style="display:inline-block;background-color:#059669;color:#ffffff;font-size:11px;font-weight:700;letter-spacing:0.5px;padding:2px 8px;border-radius:4px;text-transform:uppercase;margin-bottom:6px;">Final Round Completed</span>
                        <h3 style="margin:4px 0 6px;color:#065f46;font-size:15px;font-weight:700;">All Interview Rounds Finished</h3>
                        <p style="margin:0;color:#047857;font-size:13px;line-height:1.5;">
                            All evaluation rounds for <strong>${params.candidateName}</strong> are now complete. The candidate is ready for your final hiring decision (<strong>Hire</strong>, <strong>Reject</strong>, or <strong>Hold</strong>).
                        </p>
                    </td>
                </tr>
               </table>`
            : "";

        const interviewStatusBadge = isFinal
            ? `<span style="display:inline-block;padding:3px 10px;background-color:#dcfce7;color:#15803d;border:1px solid #86efac;border-radius:9999px;font-size:12px;font-weight:600;">Series Complete — Pending Decision</span>`
            : `<span style="display:inline-block;padding:3px 10px;background-color:#f1f5f9;color:#475569;border:1px solid #cbd5e1;border-radius:9999px;font-size:12px;font-weight:600;">In Progress</span>`;

        const actionSection = isFinal
            ? `<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;margin:24px 0 0;padding:20px;text-align:center;">
                <tr>
                    <td align="center">
                        <h3 style="margin:0 0 6px;font-size:15px;color:#1e293b;font-weight:600;">Next Step: Submit Final Decision</h3>
                        <p style="margin:0 0 16px;color:#64748b;font-size:13px;line-height:1.5;">
                            Review all evaluations and submit your final decision for this candidate from the Admin Portal.
                        </p>
                        <table cellpadding="0" cellspacing="0" align="center">
                            <tr>
                                <td style="background-color:#4f46e5;border-radius:6px;padding:10px 20px;">
                                    <span style="color:#ffffff;font-size:13px;font-weight:600;">Ready for Final Admin Review</span>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
               </table>`
            : `<p style="color:#6b7280;line-height:1.6;margin:24px 0 0;font-size:14px;">
                You can view full interview details and track progress from your Admin Dashboard.
               </p>`;

        const subjectPrefix = isFinal ? "[All Rounds Completed] " : "";
        const subject = `${subjectPrefix}Interview Feedback Submitted: ${params.candidateName} - ${params.positionName} (${params.roundInfo})`;

        const html = replaceTemplateVars(template, {
            headerBgColor,
            headerTitle,
            headerSubtitle,
            finalRoundBanner,
            adminName: params.adminName,
            candidateName: params.candidateName,
            positionName: params.positionName,
            roundInfo: params.roundInfo,
            interviewStatusBadge,
            interviewerName: params.interviewerName,
            submittedDate: params.submittedDate,
            ratingDisplay,
            recommendationBadge,
            positiveComments: params.positiveComments,
            negativeComments: params.negativeComments,
            additionalCommentsSection,
            actionSection,
        });

        return sendEmail(params.adminEmail, subject, html);
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
