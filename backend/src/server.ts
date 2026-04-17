import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { ModelRegistry, AuthStorage } from '@mariozechner/pi-coding-agent';
import authRouter from './routes/auth.js';
import { requireAuth } from './middleware/requireAuth.js';
import modelsRouter from './routes/models.js';
import sessionsRouter from './routes/sessions.js';
import chatRouter from './routes/chat.js';
import agentsRouter from './routes/agents.js';
import documentsRouter from './routes/documents.js';
import { connectDB } from './db/mongoose.js';

const app = express();
const port = process.env.PORT || 3001;

// CORS must support credentials for UI to send HttpOnly cookies
app.use(cors({
    origin: true,
    credentials: true
}));
app.use(express.json());
app.use(cookieParser());

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import fs from 'fs';

// Initialize Pi Agent Managers globally for the server
export const authStorage = AuthStorage.create();
export const modelRegistry = new ModelRegistry(
    authStorage,
    path.resolve(__dirname, '../models.json'),
);

// Authentication Routes (unprotected)
app.use('/api/auth', authRouter);

// Protected API Routes
app.use('/api/models', requireAuth, modelsRouter);
app.use('/api/sessions', requireAuth, sessionsRouter);
app.use('/api/chat', requireAuth, chatRouter);
app.use('/api/agents', requireAuth, agentsRouter);
app.use('/api/documents', requireAuth, documentsRouter);

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.listen(port, async () => {
    await connectDB();
    console.log(`AgentPlayground backend running on port ${port}`);
});
