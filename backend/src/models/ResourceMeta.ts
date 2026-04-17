import mongoose, { Schema, Document } from 'mongoose';

// Base Interfaces
export interface IBaseMeta extends Document {
  ownerId: string;
  sharedWith: Array<{ userId: string, name: string }>;
}

export interface ISessionMeta extends IBaseMeta {
    id: string; // The physical session ID string
    name: string;
}

export interface IAgentMeta extends IBaseMeta {
    id: string; // The physical agent directory name
    name: string;
    type: string;
}

export interface IDocumentMeta extends IBaseMeta {
    id: string; // The physical document UUID
    name: string;
    path: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    error?: string;
    createdAt: Date;
}

// Schemas
const BaseSchemaFields = {
    ownerId: { type: String, required: true },
    sharedWith: [{
        userId: { type: String, required: true },
        name: { type: String, required: true }
    }],
};

const SessionMetaSchema = new Schema<ISessionMeta>({
    ...BaseSchemaFields,
    id: { type: String, required: true, unique: true },
    name: { type: String, default: '' },
}, { timestamps: true });

const AgentMetaSchema = new Schema<IAgentMeta>({
    ...BaseSchemaFields,
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    type: { type: String, default: 'Unknown' },
}, { timestamps: true });

const DocumentMetaSchema = new Schema<IDocumentMeta>({
    ...BaseSchemaFields,
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    path: { type: String, required: true },
    status: { type: String, enum: ['pending', 'processing', 'completed', 'failed'], default: 'pending' },
    error: { type: String },
    createdAt: { type: Date, default: Date.now },
}, { timestamps: true });

// Exports
export const SessionMeta = mongoose.model<ISessionMeta>('SessionMeta', SessionMetaSchema);
export const AgentMeta = mongoose.model<IAgentMeta>('AgentMeta', AgentMetaSchema);
export const DocumentMeta = mongoose.model<IDocumentMeta>('DocumentMeta', DocumentMetaSchema);
