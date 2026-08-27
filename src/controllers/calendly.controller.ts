import { Request, Response } from "express";
import { calendlyService, CalendlyScheduledEvent, CalendlyInvitee } from "../service/calendly.service";
import { emailService } from "../service/email.service";
import prisma from "../lib/prisma";

interface SyncResult {
    interviewId: string;
    candidateEmail: string;
    eventDate: string;
    eventTime: string;
    duration: number;
    action: "scheduled" | "rescheduled" | "canceled";
}

function formatLocalDate(isoString: string): string {
    const date = new Date(isoString);
    return date.toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
    });
}

function formatLocalTime(isoString: string): string {
    const date = new Date(isoString);
    return date.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
    });
}

async function sendConfirmationEmails(interview: any, round: any) {
    const candidate = interview.candidate;
    const position = interview.position;
    const interviewers = interview.interviewers;
    const creator = interview.creator;

    const dateStr = formatLocalDate(round.date || interview.date);
    const timeStr = formatLocalTime(round.startTime || interview.startTime);
    const duration = calendlyService.calculateDurationMinutes(
        (round.startTime || interview.startTime).toISOString(),
        (round.endTime || interview.endTime).toISOString()
    );

    const interviewerNames = interviewers
        .map((i: any) => `${i.firstname} ${i.lastname}`)
        .join(", ");

    // Send to candidate
    await emailService.sendConfirmationToCandidate({
        candidateEmail: candidate.email,
        candidateName: `${candidate.firstname} ${candidate.lastname}`,
        positionName: position.title,
        date: dateStr,
        time: timeStr,
        duration,
        roundNumber: round.roundNumber,
    });

    // Send to each interviewer
    for (const interviewer of interviewers) {
        await emailService.sendConfirmationToInterviewer({
            interviewerEmail: interviewer.email,
            interviewerName: `${interviewer.firstname} ${interviewer.lastname}`,
            candidateName: `${candidate.firstname} ${candidate.lastname}`,
            positionName: position.title,
            date: dateStr,
            time: timeStr,
            duration,
            roundNumber: round.roundNumber,
        });
    }

    // Send to admin/creator
    await emailService.sendConfirmationToAdmin({
        adminEmail: creator.email,
        adminName: `${creator.firstname} ${creator.lastname}`,
        candidateName: `${candidate.firstname} ${candidate.lastname}`,
        positionName: position.title,
        date: dateStr,
        time: timeStr,
        duration,
        roundNumber: round.roundNumber,
        interviewerNames,
    });
}

async function sendRescheduleEmails(
    interview: any,
    round: any,
    oldStartTime: Date,
    oldEndTime: Date
) {
    const candidate = interview.candidate;
    const position = interview.position;
    const interviewers = interview.interviewers;
    const creator = interview.creator;

    const oldDateStr = formatLocalDate(oldStartTime.toISOString());
    const oldTimeStr = formatLocalTime(oldStartTime.toISOString());
    const newDateStr = formatLocalDate(round.date || interview.date);
    const newTimeStr = formatLocalTime(round.startTime || interview.startTime);

    const allRecipients = [
        { email: candidate.email, name: `${candidate.firstname} ${candidate.lastname}` },
        { email: creator.email, name: `${creator.firstname} ${creator.lastname}` },
        ...interviewers.map((i: any) => ({
            email: i.email,
            name: `${i.firstname} ${i.lastname}`,
        })),
    ];

    for (const recipient of allRecipients) {
        await emailService.sendRescheduleNotification({
            recipientEmail: recipient.email,
            recipientName: recipient.name,
            candidateName: `${candidate.firstname} ${candidate.lastname}`,
            positionName: position.title,
            oldDate: oldDateStr,
            oldTime: oldTimeStr,
            newDate: newDateStr,
            newTime: newTimeStr,
            roundNumber: round.roundNumber,
        });
    }
}

export const calendlyController = {
    async syncEvents(req: Request, res: Response) {
        try {
            const results: SyncResult[] = [];

            // 1. Get all interviews that are pending schedule
            const pendingInterviews = await prisma.interview.findMany({
                where: { status: "pending_schedule" },
                include: {
                    candidate: true,
                    position: true,
                    creator: true,
                    interviewers: true,
                    rounds: {
                        orderBy: { roundNumber: "asc" },
                        include: { interviewers: true },
                    },
                },
            });

            // 2. Get all scheduled events from Calendly (last 7 days to now + 7 days ahead)
            const now = new Date();
            const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            const sevenDaysAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

            const events = await calendlyService.getAllScheduledEvents({
                status: "active",
                minStartTime: sevenDaysAgo.toISOString(),
                maxStartTime: sevenDaysAhead.toISOString(),
            });

            // 3. For each pending interview, find matching Calendly event by candidate email
            for (const interview of pendingInterviews) {
                const candidateEmail = interview.candidate.email;

                // Find event where candidate is an invitee
                const matchingEvent = events.find((event) =>
                    event.event_guests.some(
                        (guest) =>
                            guest.email.toLowerCase() === candidateEmail.toLowerCase()
                    )
                );

                if (!matchingEvent) continue;

                // Get invitees to confirm match
                const invitees = await calendlyService.getEventInviteesAll(
                    calendlyService.extractUuidFromUri(matchingEvent.uri)
                );

                const candidateInvitee = invitees.find(
                    (inv) =>
                        inv.email.toLowerCase() === candidateEmail.toLowerCase() &&
                        inv.status === "active"
                );

                if (!candidateInvitee) continue;

                // 4. Find the pending round (first round without date/time)
                const pendingRound = interview.rounds.find(
                    (r: any) =>
                        r.status === "pending" ||
                        r.status === "pending_schedule" ||
                        (!r.date && !r.startTime)
                );

                const targetRound = pendingRound || interview.rounds[0];
                const oldStartTime = targetRound?.startTime;
                const oldEndTime = targetRound?.endTime;

                // 5. Update the round with Calendly event data
                const eventDate = formatLocalDate(matchingEvent.start_time);
                const eventStartTime = new Date(matchingEvent.start_time);
                const eventEndTime = new Date(matchingEvent.end_time);

                if (targetRound) {
                    await prisma.interviewRound.update({
                        where: { id: targetRound.id },
                        data: {
                            date: eventDate,
                            startTime: eventStartTime,
                            endTime: eventEndTime,
                            status: "scheduled",
                            calendlyEventUri: matchingEvent.uri,
                            lastSyncedAt: new Date(),
                        },
                    });
                }

                // 6. Update the interview
                await prisma.interview.update({
                    where: { id: interview.id },
                    data: {
                        date: eventDate,
                        startTime: eventStartTime,
                        endTime: eventEndTime,
                        status: "scheduled",
                        calendlyEventUri: matchingEvent.uri,
                        lastSyncedAt: new Date(),
                    },
                });

                // 7. Re-fetch the updated interview with relations
                const updatedInterview = await prisma.interview.findUnique({
                    where: { id: interview.id },
                    include: {
                        candidate: true,
                        position: true,
                        creator: true,
                        interviewers: true,
                        rounds: {
                            orderBy: { roundNumber: "asc" },
                            include: { interviewers: true },
                        },
                    },
                });

                const updatedRound = updatedInterview!.rounds.find(
                    (r) => r.id === targetRound?.id
                ) || updatedInterview!.rounds[0];

                // 8. Send confirmation emails
                await sendConfirmationEmails(updatedInterview!, updatedRound);

                const isReschedule = oldStartTime && oldEndTime;
                results.push({
                    interviewId: interview.id,
                    candidateEmail,
                    eventDate,
                    eventTime: formatLocalTime(matchingEvent.start_time),
                    duration: calendlyService.calculateDurationMinutes(
                        matchingEvent.start_time,
                        matchingEvent.end_time
                    ),
                    action: isReschedule ? "rescheduled" : "scheduled",
                });
            }

            // 9. Check for rescheduled events (events that were already synced but updated)
            const syncedInterviews = await prisma.interview.findMany({
                where: {
                    status: "scheduled",
                    calendlyEventUri: { not: null },
                    lastSyncedAt: { not: null },
                },
                include: {
                    candidate: true,
                    position: true,
                    creator: true,
                    interviewers: true,
                    rounds: {
                        orderBy: { roundNumber: "asc" },
                        include: { interviewers: true },
                    },
                },
            });

            for (const interview of syncedInterviews) {
                if (!interview.calendlyEventUri) continue;

                const calendlyEventUuid = calendlyService.extractUuidFromUri(
                    interview.calendlyEventUri
                );
                const matchingEvent = events.find(
                    (e) =>
                        calendlyService.extractUuidFromUri(e.uri) === calendlyEventUuid
                );

                if (!matchingEvent) continue;

                // Check if event was updated after our last sync
                const eventUpdatedAt = new Date(matchingEvent.updated_at);
                if (
                    interview.lastSyncedAt &&
                    eventUpdatedAt <= interview.lastSyncedAt
                ) {
                    continue;
                }

                // Event was rescheduled
                const activeRound = interview.rounds.find(
                    (r) =>
                        r.status === "scheduled" || r.status === "in-progress"
                );
                if (!activeRound) continue;

                const oldStartTime = activeRound.startTime;
                const oldEndTime = activeRound.endTime;
                const newStartTime = new Date(matchingEvent.start_time);
                const newEndTime = new Date(matchingEvent.end_time);

                // Skip if times haven't actually changed
                if (
                    oldStartTime?.getTime() === newStartTime.getTime() &&
                    oldEndTime?.getTime() === newEndTime.getTime()
                ) {
                    // Just update lastSyncedAt
                    await prisma.interview.update({
                        where: { id: interview.id },
                        data: { lastSyncedAt: new Date() },
                    });
                    continue;
                }

                const newDate = formatLocalDate(matchingEvent.start_time);

                // Update round
                await prisma.interviewRound.update({
                    where: { id: activeRound.id },
                    data: {
                        date: newDate,
                        startTime: newStartTime,
                        endTime: newEndTime,
                        lastSyncedAt: new Date(),
                    },
                });

                // Update interview
                await prisma.interview.update({
                    where: { id: interview.id },
                    data: {
                        date: newDate,
                        startTime: newStartTime,
                        endTime: newEndTime,
                        lastSyncedAt: new Date(),
                    },
                });

                // Re-fetch for emails
                const updatedInterview = await prisma.interview.findUnique({
                    where: { id: interview.id },
                    include: {
                        candidate: true,
                        position: true,
                        creator: true,
                        interviewers: true,
                        rounds: {
                            orderBy: { roundNumber: "asc" },
                            include: { interviewers: true },
                        },
                    },
                });

                const updatedRound = updatedInterview!.rounds.find(
                    (r) => r.id === activeRound.id
                );

                if (updatedInterview && updatedRound && oldStartTime && oldEndTime) {
                    await sendRescheduleEmails(
                        updatedInterview,
                        updatedRound,
                        oldStartTime,
                        oldEndTime
                    );
                }

                results.push({
                    interviewId: interview.id,
                    candidateEmail: interview.candidate.email,
                    eventDate: newDate,
                    eventTime: formatLocalTime(matchingEvent.start_time),
                    duration: calendlyService.calculateDurationMinutes(
                        matchingEvent.start_time,
                        matchingEvent.end_time
                    ),
                    action: "rescheduled",
                });
            }

            return res.json({
                message: "Sync completed",
                syncedCount: results.length,
                results,
            });
        } catch (error: any) {
            console.error("Calendly sync error:", error);
            const status = error.status || 500;
            const message = error.message || "Sync failed";
            return res.status(status).json({ message });
        }
    },

    async getEventTypes(req: Request, res: Response) {
        try {
            const eventTypes = await calendlyService.getEventTypes();
            return res.json({ eventTypes });
        } catch (error: any) {
            console.error("Failed to fetch event types:", error);
            const status = error.status || 500;
            const message = error.message || "Failed to fetch event types";
            return res.status(status).json({ message });
        }
    },

    async getSyncStatus(req: Request, res: Response) {
        try {
            const lastSyncedInterview = await prisma.interview.findFirst({
                where: { lastSyncedAt: { not: null } },
                orderBy: { lastSyncedAt: "desc" },
                select: { lastSyncedAt: true },
            });

            const pendingCount = await prisma.interview.count({
                where: { status: "pending_schedule" },
            });

            const syncedCount = await prisma.interview.count({
                where: {
                    status: "scheduled",
                    calendlyEventUri: { not: null },
                },
            });

            return res.json({
                lastSyncedAt: lastSyncedInterview?.lastSyncedAt || null,
                pendingScheduleCount: pendingCount,
                syncedCount,
            });
        } catch (error: any) {
            const status = error.status || 500;
            const message = error.message || "Failed to get sync status";
            return res.status(status).json({ message });
        }
    },

    async testEmail(req: Request, res: Response) {
        try {
            const { email } = req.body;

            if (!email) {
                return res.status(400).json({ message: "Email address is required" });
            }

            console.log(`[Email Test] Sending test email to: ${email}`);
            const info = await emailService.sendTestEmail(email);

            return res.json({
                message: "Test email sent successfully",
                messageId: info.messageId,
                response: info.response,
                envelope: info.envelope,
            });
        } catch (error: any) {
            console.error("[Email Test] Failed:", error);
            return res.status(500).json({
                message: "Failed to send test email",
                error: error.message,
                code: error.code,
                response: error.response,
            });
        }
    },
};
