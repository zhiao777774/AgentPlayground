import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import FormData from 'form-data';
import { randomUUID } from 'crypto';
import { DocumentMeta } from '../models/ResourceMeta.js';

const router = Router();

// Configuration
const UPLOAD_DIR = path.join(process.cwd(), 'memory', 'documents');
const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';

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
        const documentId = randomUUID();
        const ext = path.extname(file.originalname);
        cb(null, `${documentId}${ext}`);
    },
});

const upload = multer({
    storage,
    limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
    fileFilter: (req, file, cb) => {
        const allowed = ['application/pdf', 'text/plain'];
        if (allowed.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only PDF and TXT files are currently supported for RAG.'));
        }
    },
});

// 1. Upload Document
router.post('/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const documentId = path.parse(req.file.filename).name;
        const filePath = req.file.path;
        // Multer originalname is often interpreted as latin1, need to decode as utf8
        const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');

        // Save metadata
        const docRecord = await DocumentMeta.create({
            id: documentId,
            ownerId: req.user!.id,
            name: originalName,
            status: 'processing',
            path: filePath
        });

        // Forward to Python service asynchronously
        forwardToPythonService(documentId, filePath, originalName)
            .then(async () => {
                await DocumentMeta.updateOne({ id: documentId }, { status: 'completed' });
            })
            .catch(async (err) => {
                console.error(`Failed to process document ${documentId}:`, err);
                await DocumentMeta.updateOne({ id: documentId }, { status: 'failed', error: err.message });
            });

        // Return immediately to the client
        res.status(202).json({
            message: 'Document uploaded and queued for processing',
            document: docRecord,
        });
    } catch (error: any) {
        console.error('Upload error:', error);
        res.status(500).json({
            error: error.message || 'Failed to upload document',
        });
    }
});

// Helper to send file to Python
async function forwardToPythonService(documentId: string, filePath: string, originalName: string) {
    const form = new FormData();
    const ext = path.extname(filePath).toLowerCase();
    const contentType = ext === '.txt' ? 'text/plain' : 'application/pdf';
    form.append('file', fs.createReadStream(filePath), {
        filename: originalName,
        contentType,
    });

    const response = await axios.post(
        `${PYTHON_SERVICE_URL}/api/rag/process?document_id=${documentId}`,
        form,
        {
            headers: { ...form.getHeaders() },
            maxBodyLength: Infinity,
        },
    );

    return response.data;
}

// 2. List Documents
router.get('/', async (req, res) => {
    try {
        const userId = req.user!.id;
        // Only return documents owned by user OR shared with user
        const docsList = await DocumentMeta.find({
            $or: [{ ownerId: userId }, { 'sharedWith.userId': userId }]
        }).sort({ createdAt: -1 });

        res.json(docsList);
    } catch (error) {
        res.status(500).json({ error: 'Failed to list documents' });
    }
});

// 3. Delete Document
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user!.id;

        // Verify ownership (only owners can delete)
        const doc = await DocumentMeta.findOne({ id, ownerId: userId });
        if (!doc) {
            return res.status(404).json({ error: 'Document not found or unauthorized' });
        }

        // 1. Delete vectors from Milvus via Python service
        try {
            await axios.post(`${PYTHON_SERVICE_URL}/api/rag/delete`, { document_id: id });
        } catch (pyErr) {
            console.error(`Failed to delete vectors for ${id} in Python service, but proceeding to remove local file.`, pyErr);
        }

        // 2. Delete local file
        if (fs.existsSync(doc.path)) {
            fs.unlinkSync(doc.path);
        }

        // 3. Remove metadata
        await DocumentMeta.deleteOne({ id });

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
        const userId = req.user!.id;

        const docModel = await DocumentMeta.findOne({
            id, 
            $or: [{ ownerId: userId }, { 'sharedWith.userId': userId }]
        }).lean();

        if (!docModel) {
            return res.status(404).json({ error: 'Document not found or unauthorized' });
        }

        let doc: any = { ...docModel };

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
        const userId = req.user!.id;

        const docModel = await DocumentMeta.findOne({
            id, 
            $or: [{ ownerId: userId }, { 'sharedWith.userId': userId }]
        });

        if (!docModel) {
            return res.status(404).json({ error: 'Document not found or unauthorized' });
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
