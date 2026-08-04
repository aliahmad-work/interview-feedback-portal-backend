import multer from "multer";

const storage = multer.memoryStorage();

export const uploadResume = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
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
    }
}).single("resume");
