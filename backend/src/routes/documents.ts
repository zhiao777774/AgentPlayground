import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import FormData from 'form-data';
import { randomUUID } from 'crypto';

const router = Router();

// Configuration
const UPLOAD_DIR = path.join(process.cwd(), 'memory', 'documents');
const PYTHON_SERVICE_URL =
    process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Multer setup for local storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
        // Generate a unique ID for the document
        const documentId = randomUUID();
        // Keep the original extension
        const ext = path.extname(file.originalname);
        cb(null, `${documentId}${ext}`);
    },
});

const upload = multer({
    storage,
    limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are currently supported for RAG.'));
        }
    },
});

// In-memory simple database for document metadata (in a real app, use a DB)
// Format: { documentId: { id, name, status, createdAt, path } }
const documentsDBPath = path.join(UPLOAD_DIR, 'documents_meta.json');

const loadDB = () => {
    if (fs.existsSync(documentsDBPath)) {
        return JSON.parse(fs.readFileSync(documentsDBPath, 'utf8'));
    }
    return {};
};

const saveDB = (data: any) => {
    fs.writeFileSync(documentsDBPath, JSON.stringify(data, null, 2), 'utf8');
};

// 1. Upload Document
router.post('/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const documentId = path.parse(req.file.filename).name;
        const filePath = req.file.path;
        // Multer originalname is often interpreted as latin1, need to decode as utf8
        const originalName = Buffer.from(
            req.file.originalname,
            'latin1',
        ).toString('utf8');

        // Save metadata
        const db = loadDB();
        db[documentId] = {
            id: documentId,
            name: originalName,
            status: 'processing', // pending -> processing -> completed/failed
            createdAt: new Date().toISOString(),
            path: filePath,
        };
        saveDB(db);

        // Forward to Python service asynchronously
        // We don't await this to avoid blocking the HTTP response
        forwardToPythonService(documentId, filePath, originalName)
            .then(() => {
                const currentDb = loadDB();
                if (currentDb[documentId]) {
                    currentDb[documentId].status = 'completed';
                    saveDB(currentDb);
                }
            })
            .catch((err) => {
                console.error(`Failed to process document ${documentId}:`, err);
                const currentDb = loadDB();
                if (currentDb[documentId]) {
                    currentDb[documentId].status = 'failed';
                    currentDb[documentId].error = err.message;
                    saveDB(currentDb);
                }
            });

        // Return immediately to the client
        res.status(202).json({
            message: 'Document uploaded and queued for processing',
            document: db[documentId],
        });
    } catch (error: any) {
        console.error('Upload error:', error);
        res.status(500).json({
            error: error.message || 'Failed to upload document',
        });
    }
});

// Helper to send file to Python
async function forwardToPythonService(
    documentId: string,
    filePath: string,
    originalName: string,
) {
    const form = new FormData();
    // Use the decoded name for the form filename
    form.append('file', fs.createReadStream(filePath), {
        filename: originalName,
        contentType: 'application/pdf',
    });

    // The Python service endpoints take document_id as a query param
    const response = await axios.post(
        `${PYTHON_SERVICE_URL}/api/rag/process?document_id=${documentId}`,
        form,
        {
            headers: {
                ...form.getHeaders(),
            },
            maxBodyLength: Infinity, // For large PDFs
        },
    );

    return response.data;
}

// 2. List Documents
router.get('/', (req, res) => {
    try {
        const db = loadDB();
        const docsList = Object.values(db).sort(
            (a: any, b: any) =>
                new Date(b.createdAt).getTime() -
                new Date(a.createdAt).getTime(),
        );
        res.json(docsList);
    } catch (error) {
        res.status(500).json({ error: 'Failed to list documents' });
    }
});

// 3. Delete Document
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const db = loadDB();

        if (!db[id]) {
            return res.status(404).json({ error: 'Document not found' });
        }

        const doc = db[id];

        // 1. Delete vectors from Milvus via Python service
        try {
            await axios.post(`${PYTHON_SERVICE_URL}/api/rag/delete`, {
                document_id: id,
            });
        } catch (pyErr) {
            console.error(
                `Failed to delete vectors for ${id} in Python service, but proceeding to remove local file.`,
                pyErr,
            );
            // We continue even if Milvus deletion fails, to ensure local cleanup
        }

        // 2. Delete local file
        if (fs.existsSync(doc.path)) {
            fs.unlinkSync(doc.path);
        }

        // 3. Remove metadata
        delete db[id];
        saveDB(db);

        res.json({ message: 'Document deleted successfully' });
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ error: 'Failed to delete document' });
    }
});

// 4. Get Document Details (enriched with chunk count)
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const db = loadDB();

        if (!db[id]) {
            return res.status(404).json({ error: 'Document not found' });
        }

        const doc = { ...db[id] };

        // Try to get chunk count from Python service
        if (doc.status === 'completed') {
            try {
                const chunksRes = await axios.get(
                    `${PYTHON_SERVICE_URL}/api/rag/chunks`,
                    { params: { document_id: id, limit: 1, offset: 0 } },
                );
                doc.chunkCount = chunksRes.data.total;
            } catch {
                doc.chunkCount = null;
            }
        }

        res.json(doc);
    } catch (error) {
        res.status(500).json({ error: 'Failed to get document' });
    }
});

// 5. Get Document Chunks (proxy to Python service)
router.get('/:id/chunks', async (req, res) => {
    try {
        const { id } = req.params;
        const db = loadDB();

        if (!db[id]) {
            return res.status(404).json({ error: 'Document not found' });
        }

        const limit = parseInt(req.query.limit as string) || 50;
        const offset = parseInt(req.query.offset as string) || 0;

        const response = await axios.get(
            `${PYTHON_SERVICE_URL}/api/rag/chunks`,
            { params: { document_id: id, limit, offset } },
        );

        res.json(response.data);
    } catch (error: any) {
        console.error('Error fetching chunks:', error?.message);
        res.status(500).json({ error: 'Failed to fetch document chunks' });
    }
});

export default router;
