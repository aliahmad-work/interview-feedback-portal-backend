import { GoogleGenAI, Type } from "@google/genai";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";

export interface CandidateParsedInfo {
    firstname: string;
    lastname: string;
    email: string;
    phone: string;
    experience?: string;
    currentCompany?: string;
    currentPosition?: string;
    skills: string[];
    notes?: string;
}

export interface CandidateEvaluation {
    matchScore: number; // 0 - 100
    summary: string;
    strengths: string[];
    gaps: string[];
    tier: "TIER_1_TOP" | "TIER_2_STRONG" | "TIER_3_GOOD" | "NEGLECTED";
    shortlisted: boolean;
}

export interface ParsedResumeEvaluation {
    candidateInfo: CandidateParsedInfo;
    evaluation: CandidateEvaluation;
}

export interface JobPositionContext {
    title: string;
    description: string;
    requiredSkills: string[];
    minimumExperience: number;
    maximumExperience?: number | null;
}

function getGeminiClient(): GoogleGenAI {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error("GEMINI_API_KEY environment variable is not set");
    }
    return new GoogleGenAI({ apiKey });
}

/**
 * Extracts plain text from PDF, DOCX, or DOC buffer.
 */
export async function extractTextFromBuffer(buffer: Buffer, mimetype: string): Promise<string> {
    try {
        if (mimetype === "application/pdf") {
            try {
                const parser = new PDFParse({ data: buffer });
                const textResult = await parser.getText();
                if (textResult && textResult.text && textResult.text.trim().length > 0) {
                    return textResult.text;
                }
            } catch (pErr: any) {
                console.warn("[PDF Extraction] PDFParse getText failed, falling back to legacy extractor...", pErr.message);
            }

            // Fallback for PDF text strings if binary stream contains text
            const rawStr = buffer.toString("binary");
            return rawStr;
        } else if (
            mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
            mimetype === "application/msword"
        ) {
            const result = await mammoth.extractRawText({ buffer });
            return result.value || "";
        } else {
            // Fallback for text-based or other formats
            return buffer.toString("utf-8");
        }
    } catch (error: any) {
        console.error("Error extracting text from document:", error);
        return "";
    }
}


/**
 * Calculates priority tier based on matchScore.
 */
export function determineTier(matchScore: number): "TIER_1_TOP" | "TIER_2_STRONG" | "TIER_3_GOOD" | "NEGLECTED" {
    if (matchScore >= 95) return "TIER_1_TOP";
    if (matchScore >= 85) return "TIER_2_STRONG";
    if (matchScore >= 75) return "TIER_3_GOOD";
    return "NEGLECTED";
}

/**
 * Uses Gemini API to evaluate resume content against a Job Position strictly and factually.
 */
export async function evaluateResumeWithGemini(
    fileBuffer: Buffer,
    mimetype: string,
    filename: string,
    job: JobPositionContext
): Promise<ParsedResumeEvaluation> {
    const ai = getGeminiClient();

    const extractedText = await extractTextFromBuffer(fileBuffer, mimetype);

    if (!extractedText || extractedText.trim().length === 0) {
        throw new Error(`Could not extract any readable text from "${filename}". File might be empty, corrupted, or scanned image without OCR.`);
    }

    const systemInstruction = `You are a strict, objective, and rigorous technical recruitment evaluator.
Your job is to read candidate resumes with extreme precision and fact-check them against Job Position specifications.

CRITICAL RULES:
1. NO HALLUCINATIONS OR GUESSWORK:
   - Extract ONLY information explicitly present in the provided resume text.
   - Do NOT invent companies, skills, contact numbers, email addresses, or years of experience.
   - If a candidate did not mention their email or phone number in the resume text, return "N/A" or an empty string—NEVER fabricate fake contacts.
   - If a candidate has 2 years of experience, do NOT claim they have 5 years or that they meet a minimum requirement of 5 years.

2. EXPERIENCE CALCULATION & VERIFICATION:
   - Carefully compute total actual work experience based strictly on employment dates listed in the resume (e.g. "Jan 2021 - Present", "2019 - 2022").
   - Total Experience String: State the exact calculated duration (e.g. "2 years 6 months", "3 years").
   - Compare the candidate's verified experience against the job's minimum experience (${job.minimumExperience} years).
   - If the candidate's actual experience is below ${job.minimumExperience} years, this is a CRITICAL GAP that MUST heavily penalize the match score.

3. STRICT SCORING SYSTEM (0 - 100):
   - Tier 1 (95 - 100): Near-perfect candidate. Matches ALL required skills, meets or exceeds experience, has direct domain expertise.
   - Tier 2 (85 - 94): Strong candidate. Meets minimum experience, has almost all required core skills, minor non-critical gaps.
   - Tier 3 (75 - 84): Acceptable candidate. Meets minimum experience, has the primary required skills, but lacks some secondary requirements.
   - Neglected (< 75): Fails minimum experience requirement, OR is missing critical core skills, OR comes from an unrelated background. DO NOT artificially inflate scores above 75. Be strict and realistic.

4. ACCURATE SUMMARY & BREAKDOWN:
   - Summary: Provide an honest, fact-based 2-3 sentence evaluation highlighting their actual profile versus job requirements.
   - Strengths: List only genuine strengths found in the resume.
   - Gaps: Explicitly call out any missing required skills, experience deficits, or lack of relevant background.`;

    const userPrompt = `### TARGET JOB POSITION:
- Position Title: ${job.title}
- Required Core Skills: ${job.requiredSkills.join(", ")}
- Minimum Experience Required: ${job.minimumExperience} years
- Maximum Experience: ${job.maximumExperience ? `${job.maximumExperience} years` : "Not specified"}
- Job Description:
"""
${job.description}
"""

---
### CANDIDATE RESUME (${filename}):
"""
${extractedText}
"""

---
Analyze the resume text above strictly and extract all fields according to the schema.`;

    const requestedModel = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
    const modelsToTry = Array.from(new Set([
        requestedModel,
        "gemini-3.5-flash-lite",
        "gemini-3.5-flash",
        "gemini-3.6-flash",
        "gemini-3.7-flash",
        "gemini-flash-lite-latest",
        "gemini-flash-latest"
    ]));

    let response: any = null;
    let lastError: any = null;

    for (const model of modelsToTry) {
        try {
            response = await ai.models.generateContent({
                model,
                contents: userPrompt,
                config: {
                    systemInstruction,
                    temperature: 0.1, // Low temperature for deterministic, factual extraction
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            candidateInfo: {
                                type: Type.OBJECT,
                                properties: {
                                    firstname: { type: Type.STRING },
                                    lastname: { type: Type.STRING },
                                    email: { type: Type.STRING },
                                    phone: { type: Type.STRING },
                                    experience: { type: Type.STRING, description: "Calculated actual work experience strictly from resume dates" },
                                    currentCompany: { type: Type.STRING },
                                    currentPosition: { type: Type.STRING },
                                    skills: {
                                        type: Type.ARRAY,
                                        items: { type: Type.STRING },
                                        description: "Technical and professional skills explicitly present in the resume"
                                    },
                                    notes: { type: Type.STRING, description: "Brief objective notes on candidate education, certifications, and background" }
                                },
                                required: ["firstname", "lastname", "email", "phone", "skills"]
                            },
                            evaluation: {
                                type: Type.OBJECT,
                                properties: {
                                    matchScore: { type: Type.INTEGER, description: "Strict 0-100 score penalized for missing skills or lack of experience" },
                                    summary: { type: Type.STRING, description: "Honest 2-3 sentence summary of candidate suitability" },
                                    strengths: {
                                        type: Type.ARRAY,
                                        items: { type: Type.STRING }
                                    },
                                    gaps: {
                                        type: Type.ARRAY,
                                        items: { type: Type.STRING }
                                    }
                                },
                                required: ["matchScore", "summary", "strengths", "gaps"]
                            }
                        },
                        required: ["candidateInfo", "evaluation"]
                    }
                }
            });

            if (response && response.text) {
                break;
            }
        } catch (err: any) {
            lastError = err;
            console.warn(`Gemini generation failed with model '${model}', trying next available model...`, err.message || err);
        }
    }

    if (!response || !response.text) {
        throw new Error(lastError?.message || "Failed to generate evaluation from Gemini API with all candidate models.");
    }

    const parsed = JSON.parse(response.text) as {
        candidateInfo: CandidateParsedInfo;
        evaluation: {
            matchScore: number;
            summary: string;
            strengths: string[];
            gaps: string[];
        };
    };

    // Bound matchScore between 0 and 100
    const matchScore = Math.max(0, Math.min(100, Math.round(parsed.evaluation.matchScore || 0)));
    const tier = determineTier(matchScore);
    const shortlisted = matchScore >= 75;

    return {
        candidateInfo: {
            firstname: parsed.candidateInfo.firstname || "Unknown",
            lastname: parsed.candidateInfo.lastname || "Candidate",
            email: parsed.candidateInfo.email || "",
            phone: parsed.candidateInfo.phone || "",
            experience: parsed.candidateInfo.experience || undefined,
            currentCompany: parsed.candidateInfo.currentCompany || undefined,
            currentPosition: parsed.candidateInfo.currentPosition || undefined,
            skills: Array.isArray(parsed.candidateInfo.skills) ? parsed.candidateInfo.skills : [],
            notes: parsed.candidateInfo.notes || undefined
        },
        evaluation: {
            matchScore,
            summary: parsed.evaluation.summary,
            strengths: Array.isArray(parsed.evaluation.strengths) ? parsed.evaluation.strengths : [],
            gaps: Array.isArray(parsed.evaluation.gaps) ? parsed.evaluation.gaps : [],
            tier,
            shortlisted
        }
    };
}

