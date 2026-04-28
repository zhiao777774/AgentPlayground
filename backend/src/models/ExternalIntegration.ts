import mongoose, { Schema, Document } from 'mongoose';

export interface IExternalSystemBinding extends Document {
    systemId: string;
    systemName?: string;
    agentId: string;
    modelProvider: string;
    modelId: string;
    status: 'active' | 'disabled';
    metadata?: Record<string, unknown>;
}

export interface IExternalChatSession extends Document {
    sessionId: string;
    systemId: string;
    externalUserId: string;
    agentId: string;
    metadata?: Record<string, unknown>;
    lastActivityAt: Date;
}

export interface IExternalApiClient extends Document {
    clientId: string;
    clientName?: string;
    systemId: string;
    apiKeyPrefix: string;
    apiKeyHash: string;
    status: 'active' | 'disabled';
    scopes: string[];
    expiresAt?: Date;
    lastUsedAt?: Date;
}

const ExternalSystemBindingSchema = new Schema<IExternalSystemBinding>(
    {
        systemId: { type: String, required: true, unique: true, index: true },
        systemName: { type: String },
        agentId: { type: String, required: true },
        modelProvider: { type: String, required: true },
        modelId: { type: String, required: true },
        status: {
            type: String,
            enum: ['active', 'disabled'],
            default: 'active',
            required: true,
        },
        metadata: { type: Schema.Types.Mixed },
    },
    { timestamps: true },
);

const ExternalChatSessionSchema = new Schema<IExternalChatSession>(
    {
        sessionId: { type: String, required: true, unique: true, index: true },
        systemId: { type: String, required: true, index: true },
        externalUserId: { type: String, required: true, index: true },
        agentId: { type: String, required: true },
        metadata: { type: Schema.Types.Mixed },
        lastActivityAt: { type: Date, default: Date.now, required: true },
    },
    { timestamps: true },
);

ExternalChatSessionSchema.index({ systemId: 1, externalUserId: 1 });

const ExternalApiClientSchema = new Schema<IExternalApiClient>(
    {
        clientId: { type: String, required: true, unique: true, index: true },
        clientName: { type: String },
        systemId: { type: String, required: true, index: true },
        apiKeyPrefix: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        apiKeyHash: { type: String, required: true },
        status: {
            type: String,
            enum: ['active', 'disabled'],
            default: 'active',
            required: true,
        },
        scopes: { type: [String], default: [] },
        expiresAt: { type: Date },
        lastUsedAt: { type: Date },
    },
    { timestamps: true },
);

export const ExternalSystemBinding = mongoose.model<IExternalSystemBinding>(
    'ExternalSystemBinding',
    ExternalSystemBindingSchema,
);

export const ExternalChatSession = mongoose.model<IExternalChatSession>(
    'ExternalChatSession',
    ExternalChatSessionSchema,
);

export const ExternalApiClient = mongoose.model<IExternalApiClient>(
    'ExternalApiClient',
    ExternalApiClientSchema,
);
