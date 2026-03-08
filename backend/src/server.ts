import express from 'express';
import cors from 'cors';
import { ModelRegistry, AuthStorage } from '@mariozechner/pi-coding-agent';
import modelsRouter from './routes/models.js';
import sessionsRouter from './routes/sessions.js';
import chatRouter from './routes/chat.js';
import agentsRouter from './routes/agents.js';
import documentsRouter from './routes/documents.js';

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

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

app.use('/api/models', modelsRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api/chat', chatRouter);
app.use('/api/agents', agentsRouter);
app.use('/api/documents', documentsRouter);

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.listen(port, () => {
    console.log(`AgentPlayground backend running on port ${port}`);
});
