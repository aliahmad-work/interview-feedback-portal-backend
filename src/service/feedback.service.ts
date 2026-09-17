import prisma from "../lib/prisma";
import { emailService } from "./email.service";

interface SubmitFeedbackData {
  interviewId: string;
  roundId?: string;
  interviewerId: string;
  rating: number;
  recommendation: string;
  positiveComments: string;
  negativeComments: string;
  additionalComments: string;
}

async function notifyAdminFeedbackSubmitted(params: {
  interview: any;
  round?: any;
  totalRounds?: number;
  isFinalRound?: boolean;
  interviewerId: string;
  rating: number;
  recommendation: string;
  positiveComments: string;
  negativeComments: string;
  additionalComments?: string;
}) {
  try {
    const interviewer = await prisma.user.findUnique({
      where: { id: params.interviewerId },
      select: { firstname: true, lastname: true, email: true }
    });

    const interviewerName = interviewer
      ? `${interviewer.firstname} ${interviewer.lastname}`.trim()
      : "Interviewer";

    const candidateName = params.interview.candidate
      ? `${params.interview.candidate.firstname} ${params.interview.candidate.lastname}`.trim()
      : "Candidate";

    const positionName = params.interview.position?.title || "Job Position";

    let roundInfo = "General Interview";
    if (params.round) {
      const totalStr = params.totalRounds ? ` of ${params.totalRounds}` : "";
      const typeStr = params.round.type ? ` (${params.round.type})` : "";
      const finalStr = params.isFinalRound ? " - Final Round" : "";
      roundInfo = `Round ${params.round.roundNumber}${totalStr}${typeStr}${finalStr}`;
    } else if (params.interview.round) {
      roundInfo = `Round ${params.interview.round}${params.interview.type ? ` (${params.interview.type})` : ""}${params.isFinalRound ? " - Final Round" : ""}`;
    }

    const submittedDate = new Date().toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    });

    let adminRecipients: { email: string; name: string }[] = [];

    if (params.interview.creator?.email) {
      adminRecipients.push({
        email: params.interview.creator.email,
        name: `${params.interview.creator.firstname || "Admin"} ${params.interview.creator.lastname || ""}`.trim()
      });
    } else {
      const adminUsers = await prisma.user.findMany({
        where: { role: { name: "admin" } },
        select: { email: true, firstname: true, lastname: true }
      });
      adminRecipients = adminUsers.map((u) => ({
        email: u.email,
        name: `${u.firstname} ${u.lastname}`.trim()
      }));
    }

    for (const admin of adminRecipients) {
      await emailService.sendFeedbackSubmittedToAdmin({
        adminEmail: admin.email,
        adminName: admin.name,
        candidateName,
        positionName,
        roundInfo,
        interviewerName,
        rating: params.rating,
        recommendation: params.recommendation,
        positiveComments: params.positiveComments,
        negativeComments: params.negativeComments,
        additionalComments: params.additionalComments,
        submittedDate,
        isFinalRound: params.isFinalRound,
      });
      console.log(`[Feedback Notification] Email sent to admin (${admin.email}) for interview ${params.interview.id} [Final Round: ${Boolean(params.isFinalRound)}]`);
    }
  } catch (err: any) {
    console.error("[Feedback Notification] Failed to send feedback notification email to admin:", err?.message || err);
  }
}

export async function submitFeedback(data: SubmitFeedbackData) {
  const interview = await prisma.interview.findUnique({
    where: { id: data.interviewId },
    include: {
      candidate: {
        select: {
          id: true,
          firstname: true,
          lastname: true,
          email: true
        }
      },
      position: {
        select: {
          id: true,
          title: true
        }
      },
      creator: {
        select: {
          id: true,
          firstname: true,
          lastname: true,
          email: true
        }
      },
      rounds: {
        select: {
          id: true,
          roundNumber: true,
          type: true,
          interviewerIds: true,
          status: true
        }
      }
    }
  });

  if (!interview) {
    throw { status: 404, message: "Interview not found" };
  }

  const hasRounds = interview.rounds.length > 0;

  if (hasRounds && !data.roundId) {
    throw { status: 400, message: "roundId is required when interview has rounds" };
  }

  if (!hasRounds && data.roundId) {
    throw { status: 400, message: "roundId cannot be provided when interview has no rounds" };
  }

  if (hasRounds && data.roundId) {
    const round = interview.rounds.find((r) => r.id === data.roundId);

    if (!round) {
      throw { status: 404, message: "Round not found" };
    }

    if (!round.interviewerIds.includes(data.interviewerId)) {
      throw { status: 403, message: "You are not assigned to this round" };
    }

    if (round.status === "cancelled") {
      throw { status: 400, message: "Cannot submit feedback for a cancelled round" };
    }

    if (round.status === "pending") {
      throw { status: 400, message: "Round is not yet active" };
    }

    if (round.status === "completed") {
      throw { status: 400, message: "Round is already completed" };
    }

    const existingFeedback = await prisma.interviewFeedback.findFirst({
      where: {
        roundId: data.roundId,
        interviewerId: data.interviewerId
      }
    });

    if (existingFeedback) {
      throw { status: 409, message: "You have already submitted feedback for this round" };
    }

    const result = await prisma.$transaction(async (tx) => {
      const feedback = await tx.interviewFeedback.create({
        data: {
          interviewId: data.interviewId,
          roundId: data.roundId,
          candidateId: interview.candidateId,
          interviewerId: data.interviewerId,
          rating: data.rating,
          recommendation: data.recommendation,
          positiveComments: data.positiveComments,
          negativeComments: data.negativeComments,
          additionalComments: data.additionalComments
        },
        select: {
          id: true,
          interviewId: true,
          roundId: true,
          candidateId: true,
          interviewerId: true,
          rating: true,
          recommendation: true,
          positiveComments: true,
          negativeComments: true,
          additionalComments: true,
          submittedAt: true
        }
      });

      const submittedCount = await tx.interviewFeedback.count({
        where: {
          roundId: data.roundId,
          interviewId: data.interviewId
        }
      });

      let isRoundCompleted = false;
      let isAllRoundsCompleted = false;

      if (submittedCount >= round.interviewerIds.length) {
        isRoundCompleted = true;
        await tx.interviewRound.update({
          where: { id: data.roundId! },
          data: { status: "completed" }
        });

        const remainingActiveRounds = await tx.interviewRound.count({
          where: {
            interviewId: data.interviewId,
            status: { in: ["pending", "pending_schedule", "scheduled", "in-progress"] }
          }
        });

        if (remainingActiveRounds === 0) {
          isAllRoundsCompleted = true;
        }

        await tx.interview.update({
          where: { id: data.interviewId },
          data: remainingActiveRounds === 0
            ? { status: "completed", decision: "pending" }
            : { decision: "pending" }
        });
      }

      return { feedback, isRoundCompleted, isAllRoundsCompleted };
    });

    // Determine if this was the final round of the series
    const isFinalRound = result.isAllRoundsCompleted || (round.roundNumber === interview.rounds.length && result.isRoundCompleted);

    // Notify admin via email
    notifyAdminFeedbackSubmitted({
      interview,
      round,
      totalRounds: interview.rounds.length,
      isFinalRound,
      interviewerId: data.interviewerId,
      rating: data.rating,
      recommendation: data.recommendation,
      positiveComments: data.positiveComments,
      negativeComments: data.negativeComments,
      additionalComments: data.additionalComments
    });

    return result.feedback;
  }

  if (!interview.interviewerIds.includes(data.interviewerId)) {
    throw { status: 403, message: "You are not assigned to this interview" };
  }

  const existingFeedback = await prisma.interviewFeedback.findFirst({
    where: {
      interviewId: data.interviewId,
      interviewerId: data.interviewerId,
      roundId: null
    }
  });

  if (existingFeedback) {
    throw { status: 409, message: "You have already submitted feedback for this interview" };
  }

  const result = await prisma.$transaction(async (tx) => {
    const feedback = await tx.interviewFeedback.create({
      data: {
        interviewId: data.interviewId,
        candidateId: interview.candidateId,
        interviewerId: data.interviewerId,
        rating: data.rating,
        recommendation: data.recommendation,
        positiveComments: data.positiveComments,
        negativeComments: data.negativeComments,
        additionalComments: data.additionalComments
      },
      select: {
        id: true,
        interviewId: true,
        roundId: true,
        candidateId: true,
        interviewerId: true,
        rating: true,
        recommendation: true,
        positiveComments: true,
        negativeComments: true,
        additionalComments: true,
        submittedAt: true
      }
    });

    await tx.interview.update({
      where: { id: data.interviewId },
      data: { status: "completed", decision: "pending" }
    });

    return feedback;
  });

  // Single-round interviews are immediately complete
  notifyAdminFeedbackSubmitted({
    interview,
    totalRounds: 1,
    isFinalRound: true,
    interviewerId: data.interviewerId,
    rating: data.rating,
    recommendation: data.recommendation,
    positiveComments: data.positiveComments,
    negativeComments: data.negativeComments,
    additionalComments: data.additionalComments
  });

  return result;
}

export async function getFeedbackByInterview(interviewId: string, userId: string, userRole: string) {
  const interview = await prisma.interview.findUnique({
    where: { id: interviewId },
    select: {
      id: true,
      rounds: {
        select: { id: true }
      }
    }
  });

  if (!interview) {
    throw { status: 404, message: "Interview not found" };
  }

  const hasRounds = interview.rounds.length > 0;

  if (userRole === "interviewer") {
    if (hasRounds) {
      const feedbacks = await prisma.interviewFeedback.findMany({
        where: {
          interviewId,
          interviewerId: userId,
          roundId: { not: null }
        },
        select: {
          id: true,
          interviewId: true,
          roundId: true,
          candidateId: true,
          interviewerId: true,
          interviewer: {
            select: {
              id: true,
              firstname: true,
              lastname: true,
              email: true
            }
          },
          round: {
            select: {
              id: true,
              roundNumber: true,
              type: true,
              date: true
            }
          },
          rating: true,
          recommendation: true,
          positiveComments: true,
          negativeComments: true,
          additionalComments: true,
          submittedAt: true
        },
        orderBy: { submittedAt: "asc" }
      });
      return feedbacks;
    }

    const feedback = await prisma.interviewFeedback.findFirst({
      where: {
        interviewId,
        interviewerId: userId,
        roundId: null
      },
      select: {
        id: true,
        interviewId: true,
        roundId: true,
        candidateId: true,
        interviewerId: true,
        interviewer: {
          select: {
            id: true,
            firstname: true,
            lastname: true,
            email: true
          }
        },
        rating: true,
        recommendation: true,
        positiveComments: true,
        negativeComments: true,
        additionalComments: true,
        submittedAt: true
      }
    });
    return feedback;
  }

  const feedbacks = await prisma.interviewFeedback.findMany({
    where: { interviewId },
    select: {
      id: true,
      interviewId: true,
      roundId: true,
      candidateId: true,
      interviewerId: true,
      interviewer: {
        select: {
          id: true,
          firstname: true,
          lastname: true,
          email: true
        }
      },
      round: {
        select: {
          id: true,
          roundNumber: true,
          type: true,
          date: true
        }
      },
      rating: true,
      recommendation: true,
      positiveComments: true,
      negativeComments: true,
      additionalComments: true,
      submittedAt: true
    },
    orderBy: { submittedAt: "asc" }
  });
  return feedbacks;
}
