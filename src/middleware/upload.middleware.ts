import multer from "multer";

const storage = multer.memoryStorage();

const fileFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    const allowed = [
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ];
    if (!file.mimetype || allowed.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error("Only PDF, DOC, and DOCX files are allowed"));
    }
};

export const uploadResume = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter
}).single("resume");

export const uploadMultipleResumes = multer({
    storage,
    limits: { fileSize: 15 * 1024 * 1024 }, // 15MB per file limit
    fileFilter
}).array("resumes", 30); // Accept up to 30 resumes in a batch

