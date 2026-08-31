import prisma from "../lib/prisma";

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

export async function submitFeedback(data: SubmitFeedbackData) {
  const interview = await prisma.interview.findUnique({
    where: { id: data.interviewId },
    select: {
      id: true,
      candidateId: true,
      interviewerIds: true,
      status: true,
      rounds: {
        select: { id: true }
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
    const round = await prisma.interviewRound.findFirst({
      where: {
        id: data.roundId,
        interviewId: data.interviewId
      },
      select: {
        id: true,
        interviewerIds: true,
        status: true
      }
    });

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

      if (submittedCount >= round.interviewerIds.length) {
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

        await tx.interview.update({
          where: { id: data.interviewId },
          data: remainingActiveRounds === 0
            ? { status: "completed", decision: "pending" }
            : { decision: "pending" }
        });
      }

      return feedback;
    });

    return result;
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
