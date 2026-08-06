import prisma from "../lib/prisma";

interface SubmitFeedbackData {
  interviewId: string;
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
      status: true
    }
  });

  if (!interview) {
    throw { status: 404, message: "Interview not found" };
  }

  if (!interview.interviewerIds.includes(data.interviewerId)) {
    throw { status: 403, message: "You are not assigned to this interview" };
  }

  const existingFeedback = await prisma.interviewFeedback.findFirst({
    where: {
      interviewId: data.interviewId,
      interviewerId: data.interviewerId
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
    select: { id: true }
  });

  if (!interview) {
    throw { status: 404, message: "Interview not found" };
  }

  if (userRole === "interviewer") {
    const feedback = await prisma.interviewFeedback.findFirst({
      where: {
        interviewId,
        interviewerId: userId
      },
      select: {
        id: true,
        interviewId: true,
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
  return feedbacks;
}
