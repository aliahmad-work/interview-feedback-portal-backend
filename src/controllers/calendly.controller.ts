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
    if (isNaN(date.getTime())) return isoString;
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function formatDisplayDate(value: string): string {
    if (!value) return "";
    // Handle YYYY-MM-DD (stored format) without UTC/timezone day-shift
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (m) {
        const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        if (!isNaN(date.getTime())) {
            return date.toLocaleDateString("en-US", {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
            });
        }
    }
    const date = new Date(value);
    if (isNaN(date.getTime())) return value;
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

async function sendConfirmationEmails(interview: any, round: any, event?: any) {
    const candidate = interview.candidate;
    const position = interview.position;
    const roundInterviewers = round.interviewers || [];
    const creator = interview.creator;
    const rescheduleUrl = round.calendlyRescheduleUrl || "";
    const meetingUrl = event ? calendlyService.extractMeetingUrl(event) || undefined : undefined;

    const dateStr = formatDisplayDate(round.date || interview.date);
    const timeStr = formatLocalTime(round.startTime || interview.startTime);
    const duration = calendlyService.calculateDurationMinutes(
        (round.startTime || interview.startTime).toISOString(),
        (round.endTime || interview.endTime).toISOString()
    );

    const interviewerNames = roundInterviewers
        .map((i: any) => `${i.firstname} ${i.lastname}`)
        .join(", ");

    // Candidate CV (stored as binary in the DB) to attach to scheduling/confirmation emails
    const resume = {
        candidateFirstname: candidate.firstname,
        candidateLastname: candidate.lastname,
        resumeData: candidate.resumeData,
        resumeMimeType: candidate.resumeMimeType,
    };

    // Send to candidate
    await emailService.sendConfirmationToCandidate({
        candidateEmail: candidate.email,
        candidateName: `${candidate.firstname} ${candidate.lastname}`,
        positionName: position.title,
        date: dateStr,
        time: timeStr,
        duration,
        roundNumber: round.roundNumber,
        meetingUrl,
        resume,
    });

    // Send to interviewers assigned to THIS round only
    for (const interviewer of roundInterviewers) {
        await emailService.sendConfirmationToInterviewer({
            interviewerEmail: interviewer.email,
            interviewerName: `${interviewer.firstname} ${interviewer.lastname}`,
            candidateName: `${candidate.firstname} ${candidate.lastname}`,
            positionName: position.title,
            date: dateStr,
            time: timeStr,
            duration,
            roundNumber: round.roundNumber,
            rescheduleUrl,
            meetingUrl,
            resume,
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
        meetingUrl,
        resume,
    });
}

async function sendRescheduleEmails(
    interview: any,
    round: any,
    oldStartTime: Date,
    oldEndTime: Date,
    event?: any
) {
    const candidate = interview.candidate;
    const position = interview.position;
    const roundInterviewers = round.interviewers || [];
    const creator = interview.creator;
    const rescheduleUrl = round.calendlyRescheduleUrl || "";
    const meetingUrl = event ? calendlyService.extractMeetingUrl(event) || undefined : undefined;

    const oldDateStr = formatDisplayDate(oldStartTime.toISOString());
    const oldTimeStr = formatLocalTime(oldStartTime.toISOString());
    const newDateStr = formatDisplayDate(round.date || interview.date);
    const newTimeStr = formatLocalTime(round.startTime || interview.startTime);

    const allRecipients = [
        { email: candidate.email, name: `${candidate.firstname} ${candidate.lastname}` },
        { email: creator.email, name: `${creator.firstname} ${creator.lastname}` },
        ...roundInterviewers.map((i: any) => ({
            email: i.email,
            name: `${i.firstname} ${i.lastname}`,
        })),
    ];

    // Candidate CV (stored as binary in the DB) to attach to reschedule notifications
    const resume = {
        candidateFirstname: candidate.firstname,
        candidateLastname: candidate.lastname,
        resumeData: candidate.resumeData,
        resumeMimeType: candidate.resumeMimeType,
    };

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
            rescheduleUrl,
            meetingUrl,
            resume,
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

            console.log(`[Calendly Sync] Found ${pendingInterviews.length} pending schedule interview(s)`);

            // 2. For each pending interview, query Calendly using invitee_email filter
            for (const interview of pendingInterviews) {
                try {
                    const candidateEmail = interview.candidate.email;
                    console.log(`[Calendly Sync] Checking interview ${interview.id} for candidate: ${candidateEmail}`);

                    // Use the invitee_email API filter — this queries Calendly for events
                    // where the candidate is the actual booker (invitee), not a guest
                    const now = new Date();
                    const thirtyDaysAhead = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

                    // A pending interview is awaiting a NEW booking, so only match FUTURE
                    // events. Matching past events caused interviews to be synced to
                    // stale/past dates with expired reschedule URLs ("event is in the past").
                    const matchingEvents = await calendlyService.getAllScheduledEvents({
                        status: "active",
                        minStartTime: now.toISOString(),
                        maxStartTime: thirtyDaysAhead.toISOString(),
                    });

                    // Find events where the candidate is the invitee
                    let matchingEvent: CalendlyScheduledEvent | null = null;
                    let candidateRescheduleUrl: string | null = null;
                    for (const event of matchingEvents) {
                        const eventUuid = calendlyService.extractUuidFromUri(event.uri);
                        try {
                            const invitees = await calendlyService.getEventInviteesAll(eventUuid);
                            const candidateInvitee = invitees.find(
                                (inv) =>
                                    inv.email.toLowerCase() === candidateEmail.toLowerCase() &&
                                    inv.status === "active"
                            );
                            if (candidateInvitee) {
                                matchingEvent = event;
                                candidateRescheduleUrl = candidateInvitee.reschedule_url || null;
                                console.log(`[Calendly Sync] Found matching Calendly event for ${candidateEmail}: ${event.uri}`);
                                break;
                            }
                        } catch (inviteeError: any) {
                            console.error(`[Calendly Sync] Failed to fetch invitees for event ${eventUuid}:`, inviteeError.message);
                        }
                    }

                    if (!matchingEvent) {
                        console.log(`[Calendly Sync] No Calendly event found for candidate: ${candidateEmail} (interview: ${interview.id})`);
                        continue;
                    }

                    // 3. Find the pending round (first round without date/time)
                    const pendingRound = interview.rounds.find(
                        (r: any) =>
                            r.status === "pending" ||
                            r.status === "pending_schedule" ||
                            (!r.date && !r.startTime)
                    );

                    const targetRound = pendingRound || interview.rounds[0];
                    const oldStartTime = targetRound?.startTime;
                    const oldEndTime = targetRound?.endTime;

                    // 4. Update the round with Calendly event data
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
                                calendlyRescheduleUrl: candidateRescheduleUrl,
                                lastSyncedAt: new Date(),
                            },
                        });
                        console.log(`[Calendly Sync] Updated round ${targetRound.roundNumber} with date: ${eventDate}`);
                    }

                    // 5. Update the interview
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

                    // 6. Re-fetch the updated interview with relations
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

                    // 7. Send confirmation emails
                    try {
                        await sendConfirmationEmails(updatedInterview!, updatedRound, matchingEvent);
                        console.log(`[Calendly Sync] Confirmation emails sent for interview ${interview.id}`);
                    } catch (emailError: any) {
                        console.error(`[Calendly Sync] Failed to send confirmation emails for interview ${interview.id}:`, emailError.message);
                    }

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

                    console.log(`[Calendly Sync] Successfully synced interview ${interview.id} - ${isReschedule ? "rescheduled" : "scheduled"}`);
                } catch (interviewError: any) {
                    console.error(`[Calendly Sync] Error processing interview ${interview.id}:`, interviewError.message);
                    // Continue to next interview — don't let one failure block all syncs
                }
            }

            // 8. Check for rescheduled events (events that were already synced but updated)
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
                try {
                    if (!interview.calendlyEventUri) continue;

                    const calendlyEventUuid = calendlyService.extractUuidFromUri(
                        interview.calendlyEventUri
                    );
                    const candidateEmail = interview.candidate.email.toLowerCase();

                    // Compute time window based on the stored start/end time
                    const timeWindowStart = interview.startTime
                        ? new Date(new Date(interview.startTime).getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
                        : undefined;
                    const timeWindowEnd = interview.endTime
                        ? new Date(new Date(interview.endTime).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
                        : undefined;

                    // Step 1: Try to find the event in active events (same URI)
                    let matchingEvent: CalendlyScheduledEvent | null = null;
                    let isNewEvent = false;
                    try {
                        const activeEvents = await calendlyService.getAllScheduledEvents({
                            status: "active",
                            minStartTime: timeWindowStart,
                            maxStartTime: timeWindowEnd,
                        });
                        matchingEvent = activeEvents.find(
                            (e) => calendlyService.extractUuidFromUri(e.uri) === calendlyEventUuid
                        ) || null;
                    } catch (fetchError: any) {
                        console.error(`[Calendly Sync] Failed to fetch active events for interview ${interview.id}:`, fetchError.message);
                        continue;
                    }

                    // Step 2: If not found in active events, the event may have been
                    // replaced by Calendly (reschedule creates a new event, cancels old).
                    // Check for a canceled event matching our stored URI.
                    if (!matchingEvent) {
                        console.log(`[Calendly Sync] Event ${calendlyEventUuid} not found in active events for interview ${interview.id}, checking for canceled events...`);
                        try {
                            const canceledEvents = await calendlyService.getAllScheduledEvents({
                                status: "canceled",
                                minStartTime: timeWindowStart,
                                maxStartTime: timeWindowEnd,
                            });
                            const canceledEvent = canceledEvents.find(
                                (e) => calendlyService.extractUuidFromUri(e.uri) === calendlyEventUuid
                            );

                            if (canceledEvent) {
                                console.log(`[Calendly Sync] Found canceled event ${calendlyEventUuid} — interview was rescheduled, searching for new event...`);

                                // Strategy 1: Use Calendly's invitee_email filter
                                const candidateEvents = await calendlyService.getAllScheduledEvents({
                                    status: "active",
                                    inviteeEmail: interview.candidate.email.toLowerCase(),
                                });

                                if (candidateEvents.length > 0) {
                                    matchingEvent = candidateEvents[0];
                                    isNewEvent = true;
                                    console.log(`[Calendly Sync] Found replacement event ${matchingEvent.uri} via invitee_email filter`);
                                }

                                // Strategy 2: Use Calendly's native invitee linkage (old_invitee → new_invitee)
                                if (!matchingEvent) {
                                    try {
                                        const canceledInvitees = await calendlyService.getEventInviteesAll(calendlyEventUuid, "canceled");
                                        const rescheduledInvitee = canceledInvitees.find(
                                            (inv) => inv.email.toLowerCase() === candidateEmail && inv.new_invitee
                                        );

                                        if (rescheduledInvitee?.new_invitee) {
                                            console.log(`[Calendly Sync] Found rescheduled invitee linkage, extracting new event...`);
                                            // new_invitee URI format: https://api.calendly.com/scheduled_events/{eventUuid}/invitees/{inviteeUuid}
                                            const newInviteeParts = rescheduledInvitee.new_invitee.split("/");
                                            const newEventUuid = newInviteeParts[newInviteeParts.indexOf("scheduled_events") + 1];

                                            if (newEventUuid) {
                                                // Fetch the new event
                                                const newEvents = await calendlyService.getAllScheduledEvents({
                                                    status: "active",
                                                });
                                                matchingEvent = newEvents.find(
                                                    (e) => calendlyService.extractUuidFromUri(e.uri) === newEventUuid
                                                ) || null;
                                                if (matchingEvent) {
                                                    isNewEvent = true;
                                                    console.log(`[Calendly Sync] Found replacement event ${matchingEvent.uri} via invitee linkage`);
                                                }
                                            }
                                        }
                                    } catch (linkageError: any) {
                                        console.error(`[Calendly Sync] Failed to use invitee linkage:`, linkageError.message);
                                    }
                                }
                            }
                        } catch (canceledError: any) {
                            console.error(`[Calendly Sync] Failed to fetch canceled events for interview ${interview.id}:`, canceledError.message);
                            continue;
                        }
                    }

                    if (!matchingEvent) continue;

                    // Handle canceled events (explicit cancel, not reschedule)
                    if (matchingEvent.status === "canceled" && !isNewEvent) {
                        console.log(`[Calendly Sync] Detected canceled event for interview ${interview.id}`);

                        const activeRound = interview.rounds.find(
                            (r) => r.status === "scheduled" || r.status === "in-progress"
                        );
                        if (activeRound) {
                            await prisma.interviewRound.update({
                                where: { id: activeRound.id },
                                data: { status: "cancelled", lastSyncedAt: new Date() },
                            });
                        }

                        await prisma.interview.update({
                            where: { id: interview.id },
                            data: { status: "cancelled", lastSyncedAt: new Date() },
                        });

                        console.log(`[Calendly Sync] Interview ${interview.id} marked as cancelled`);
                        continue;
                    }

                    // Check if event was updated after our last sync
                    const eventUpdatedAt = new Date(matchingEvent.updated_at);
                    if (
                        !isNewEvent &&
                        interview.lastSyncedAt &&
                        eventUpdatedAt <= interview.lastSyncedAt
                    ) {
                        continue;
                    }

                    // Event was rescheduled (either same URI updated, or new URI replacement)
                    const activeRound = interview.rounds.find(
                        (r) =>
                            r.status === "scheduled" || r.status === "in-progress"
                    );
                    if (!activeRound) continue;

                    const oldStartTime = activeRound.startTime;
                    const oldEndTime = activeRound.endTime;
                    const newStartTime = new Date(matchingEvent.start_time);
                    const newEndTime = new Date(matchingEvent.end_time);

                    // Skip if times haven't actually changed (and not a new event replacement)
                    if (
                        !isNewEvent &&
                        oldStartTime?.getTime() === newStartTime.getTime() &&
                        oldEndTime?.getTime() === newEndTime.getTime()
                    ) {
                        await prisma.interview.update({
                            where: { id: interview.id },
                            data: { lastSyncedAt: new Date() },
                        });
                        continue;
                    }

                    const newDate = formatLocalDate(matchingEvent.start_time);
                    const newEventUuid = calendlyService.extractUuidFromUri(matchingEvent.uri);

                    // Re-fetch invitees from the NEW event to get updated reschedule_url
                    let updatedRescheduleUrl: string | null = null;
                    try {
                        const updatedInvitees = await calendlyService.getEventInviteesAll(newEventUuid);
                        const candidateInvitee = updatedInvitees.find(
                            (inv) => inv.email.toLowerCase() === candidateEmail && inv.status === "active"
                        );
                        if (candidateInvitee) {
                            updatedRescheduleUrl = candidateInvitee.reschedule_url || null;
                        }
                    } catch (invError: any) {
                        console.error(`[Calendly Sync] Failed to re-fetch invitees for reschedule URL:`, invError.message);
                    }

                    await prisma.interviewRound.update({
                        where: { id: activeRound.id },
                        data: {
                            date: newDate,
                            startTime: newStartTime,
                            endTime: newEndTime,
                            calendlyEventUri: matchingEvent.uri,
                            calendlyRescheduleUrl: updatedRescheduleUrl,
                            lastSyncedAt: new Date(),
                        },
                    });

                    await prisma.interview.update({
                        where: { id: interview.id },
                        data: {
                            date: newDate,
                            startTime: newStartTime,
                            endTime: newEndTime,
                            calendlyEventUri: matchingEvent.uri,
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
                        try {
                            await sendRescheduleEmails(
                                updatedInterview,
                                updatedRound,
                                oldStartTime,
                                oldEndTime,
                                matchingEvent
                            );
                            console.log(`[Calendly Sync] Reschedule emails sent for interview ${interview.id}`);
                        } catch (emailError: any) {
                            console.error(`[Calendly Sync] Failed to send reschedule emails for interview ${interview.id}:`, emailError.message);
                        }
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

                    console.log(`[Calendly Sync] Rescheduled interview ${interview.id}`);
                } catch (interviewError: any) {
                    console.error(`[Calendly Sync] Error checking reschedule for interview ${interview.id}:`, interviewError.message);
                }
            }

            console.log(`[Calendly Sync] Completed. Synced ${results.length} event(s)`);
            return res.json({
                message: "Sync completed",
                syncedCount: results.length,
                results,
            });
        } catch (error: any) {
            console.error("[Calendly Sync] Fatal error:", error);
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
