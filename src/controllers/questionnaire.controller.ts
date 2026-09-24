import { Request, Response } from "express";
import prisma from "../lib/prisma";
import { emailService } from "../service/email.service";

// --- ADMIN ROUTES ---

export const createTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, questions } = req.body;
    
    // In auth middleware, user ID is typically on req.user.id
    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const template = await prisma.questionnaireTemplate.create({
      data: {
        name,
        questions,
        createdBy: userId
      }
    });

    res.status(201).json(template);
  } catch (error) {
    console.error("Error creating questionnaire template:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const getTemplates = async (req: Request, res: Response): Promise<void> => {
  try {
    const templates = await prisma.questionnaireTemplate.findMany({
      orderBy: { createdAt: "desc" }
    });
    res.json(templates);
  } catch (error) {
    console.error("Error fetching questionnaire templates:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const updateTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { name, questions } = req.body;

    const existing = await prisma.questionnaireTemplate.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ message: "Questionnaire template not found" });
      return;
    }

    const template = await prisma.questionnaireTemplate.update({
      where: { id },
      data: {
        ...(name ? { name } : {}),
        ...(questions ? { questions } : {})
      }
    });

    res.json(template);
  } catch (error) {
    console.error("Error updating questionnaire template:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const deleteTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;

    const existing = await prisma.questionnaireTemplate.findUnique({
      where: { id },
      include: {
        _count: {
          select: { candidateQuestionnaires: true }
        }
      }
    });

    if (!existing) {
      res.status(404).json({ message: "Questionnaire template not found" });
      return;
    }

    // Check if there are active/existing questionnaires using this template
    if (existing._count.candidateQuestionnaires > 0) {
      res.status(400).json({ 
        message: "Cannot delete this template because it is associated with existing candidate questionnaires." 
      });
      return;
    }

    await prisma.questionnaireTemplate.delete({
      where: { id }
    });

    res.json({ message: "Questionnaire template deleted successfully" });
  } catch (error) {
    console.error("Error deleting questionnaire template:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// --- CANDIDATE PUBLIC ROUTES ---

export const getQuestionnaireByToken = async (req: Request, res: Response): Promise<void> => {
  try {
    const token = req.params.token as string;

    const questionnaire = await prisma.candidateQuestionnaire.findUnique({
      where: { token },
      include: {
        template: true,
        candidate: {
          select: { firstname: true, lastname: true }
        }
      }
    });

    if (!questionnaire) {
      res.status(404).json({ message: "Questionnaire not found or invalid link." });
      return;
    }

    if (questionnaire.status !== "pending") {
      res.status(400).json({ message: "This questionnaire has already been completed." });
      return;
    }

    res.json({
      id: questionnaire.id,
      candidateName: `${questionnaire.candidate.firstname} ${questionnaire.candidate.lastname}`,
      questions: questionnaire.template.questions,
    });
  } catch (error) {
    console.error("Error fetching questionnaire by token:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const submitQuestionnaire = async (req: Request, res: Response): Promise<void> => {
  try {
    const token = req.params.token as string;
    const { isInterested, answers } = req.body;

    const questionnaire = await prisma.candidateQuestionnaire.findUnique({
      where: { token },
      include: {
        candidate: true,
        interview: {
          include: {
            creator: true,
            position: true
          }
        }
      }
    });

    if (!questionnaire) {
      res.status(404).json({ message: "Questionnaire not found." });
      return;
    }

    if (questionnaire.status !== "pending") {
      res.status(400).json({ message: "This questionnaire has already been completed." });
      return;
    }

    if (isInterested === false) {
      // Candidate is not interested
      await prisma.$transaction([
        prisma.candidateQuestionnaire.update({
          where: { id: questionnaire.id },
          data: { status: "not_interested" }
        }),
        prisma.candidate.update({
          where: { id: questionnaire.candidateId },
          data: { status: "not_interested" }
        })
      ]);

      res.json({ message: "Thank you for letting us know." });
      return;
    }

    // Candidate is interested
    await prisma.candidateQuestionnaire.update({
      where: { id: questionnaire.id },
      data: {
        status: "completed",
        answers
      }
    });

    // Notify admin creator via email
    if (questionnaire.interview?.creator?.email) {
      try {
        await emailService.sendQuestionnaireSubmittedToAdmin({
          adminEmail: questionnaire.interview.creator.email,
          candidateName: `${questionnaire.candidate.firstname} ${questionnaire.candidate.lastname}`,
          candidateEmail: questionnaire.candidate.email,
          positionName: questionnaire.interview.position.title,
          answers: answers || {}
        });
      } catch (emailErr) {
        console.error("Failed to send questionnaire completion email to admin:", emailErr);
      }
    }

    res.json({ 
      message: "Questionnaire submitted successfully.",
      calendlyLink: questionnaire.calendlyLink
    });
  } catch (error) {
    console.error("Error submitting questionnaire:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};
