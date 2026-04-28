import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { ExternalApiClient } from '../models/ExternalIntegration.js';

export interface ExternalPrincipal {
    principalType: 'external_system';
    systemId: string;
    systemName?: string;
    scopes: string[];
    subject: string;
    authMode: 'api_key' | 'gateway_jwt';
    clientId?: string;
    rawClaims?: Record<string, unknown>;
}

declare global {
    namespace Express {
        interface Request {
            externalPrincipal?: ExternalPrincipal;
        }
    }
}

type ExternalAuthMode = 'api_key' | 'gateway_jwt';

function normalizePem(raw?: string): string | undefined {
    if (!raw) return undefined;
    return raw.replace(/\\n/g, '\n');
}

function parseScopes(scopes: unknown): string[] {
    if (Array.isArray(scopes)) {
        return scopes.map(String).filter(Boolean);
    }
    if (typeof scopes === 'string') {
        return scopes
            .split(/[,\s]+/)
            .map((scope) => scope.trim())
            .filter(Boolean);
    }
    return [];
}

function sha256(value: string): Buffer {
    return crypto.createHash('sha256').update(value).digest();
}

function getExternalAuthMode(): ExternalAuthMode {
    const mode = (process.env.EXTERNAL_AUTH_MODE || 'api_key').toLowerCase();
    if (mode !== 'api_key' && mode !== 'gateway_jwt') {
        throw new Error(
            `Unsupported EXTERNAL_AUTH_MODE: ${process.env.EXTERNAL_AUTH_MODE}`,
        );
    }
    return mode;
}

function getApiKeyHeaderName(): string {
    return (process.env.EXTERNAL_API_KEY_HEADER || 'x-api-key').toLowerCase();
}

function extractApiKey(req: Request): string | null {
    const headerName = getApiKeyHeaderName();
    const directHeader = req.header(headerName);
    if (directHeader?.trim()) {
        return directHeader.trim();
    }
    return null;
}

function parseApiKey(apiKey: string): { prefix: string } | null {
    const match = apiKey.match(/^apg_([^_]+)_.+$/);
    if (!match) return null;
    return { prefix: match[1] };
}

async function authenticateApiKey(req: Request, res: Response) {
    const apiKey = extractApiKey(req);
    if (!apiKey) {
        res.status(401).json({ error: 'Missing API key' });
        return false;
    }

    const parsed = parseApiKey(apiKey);
    if (!parsed) {
        res.status(401).json({ error: 'Invalid API key format' });
        return false;
    }

    const apiClient = await ExternalApiClient.findOne({
        apiKeyPrefix: parsed.prefix,
    });

    if (!apiClient || apiClient.status !== 'active') {
        res.status(401).json({ error: 'Invalid API key' });
        return false;
    }

    if (apiClient.expiresAt && apiClient.expiresAt.getTime() <= Date.now()) {
        res.status(401).json({ error: 'API key expired' });
        return false;
    }

    const expected = Buffer.from(apiClient.apiKeyHash, 'hex');
    const actual = sha256(apiKey);
    if (
        expected.length !== actual.length ||
        !crypto.timingSafeEqual(expected, actual)
    ) {
        res.status(401).json({ error: 'Invalid API key' });
        return false;
    }

    apiClient.lastUsedAt = new Date();
    await apiClient.save();

    req.externalPrincipal = {
        principalType: 'external_system',
        systemId: apiClient.systemId,
        systemName: apiClient.clientName || apiClient.systemId,
        scopes: apiClient.scopes || [],
        subject: apiClient.clientId,
        authMode: 'api_key',
        clientId: apiClient.clientId,
    };

    return true;
}

async function authenticateGatewayJwt(req: Request, res: Response) {
    const authHeader = req.header('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Missing bearer token' });
        return false;
    }

    const token = authHeader.slice('Bearer '.length).trim();
    const publicKey = normalizePem(process.env.GATEWAY_PUBLIC_KEY_PEM);
    const issuer = process.env.GATEWAY_ISSUER;
    const audience = process.env.JWT_AUDIENCE;

    if (!publicKey || !issuer || !audience) {
        console.error(
            '[ExternalAuth] Missing gateway JWT configuration env vars.',
        );
        res.status(500).json({
            error: 'External JWT authentication is not configured',
        });
        return false;
    }

    try {
        const decoded = jwt.verify(token, publicKey, {
            algorithms: ['RS256'],
            issuer,
            audience,
        }) as jwt.JwtPayload & Record<string, unknown>;

        const principalType = decoded.principal_type;
        const systemId = decoded.system_id;
        const subject = decoded.sub;

        if (
            principalType !== 'external_system' ||
            typeof systemId !== 'string' ||
            typeof subject !== 'string'
        ) {
            res.status(401).json({
                error: 'Invalid token claims for external system access',
            });
            return false;
        }

        req.externalPrincipal = {
            principalType: 'external_system',
            systemId,
            systemName:
                typeof decoded.system_name === 'string'
                    ? decoded.system_name
                    : undefined,
            scopes: parseScopes(decoded.scopes),
            subject,
            authMode: 'gateway_jwt',
            rawClaims: decoded,
        };

        return true;
    } catch {
        res.status(401).json({ error: 'Invalid or expired token' });
        return false;
    }
}

export function validateExternalAuthConfig() {
    const mode = getExternalAuthMode();

    if (mode === 'api_key') {
        return {
            mode,
            apiKeyHeader: getApiKeyHeaderName(),
        };
    }

    const missing = [
        'GATEWAY_PUBLIC_KEY_PEM',
        'GATEWAY_ISSUER',
        'JWT_AUDIENCE',
    ].filter((name) => !process.env[name]);

    if (missing.length > 0) {
        throw new Error(
            `Missing required env for gateway_jwt external auth mode: ${missing.join(', ')}`,
        );
    }

    return {
        mode,
        apiKeyHeader: getApiKeyHeaderName(),
    };
}

export const requireExternalAuth = async (
    req: Request,
    res: Response,
    next: NextFunction,
) => {
    const mode = getExternalAuthMode();
    const ok =
        mode === 'api_key'
            ? await authenticateApiKey(req, res)
            : await authenticateGatewayJwt(req, res);

    if (!ok) return;
    return next();
};

export const requireExternalScope =
    (requiredScope: string) =>
    (req: Request, res: Response, next: NextFunction) => {
        const principal = req.externalPrincipal;
        if (!principal) {
            return res.status(401).json({ error: 'Unauthenticated' });
        }

        if (!principal.scopes.includes(requiredScope)) {
            return res.status(403).json({
                error: 'Forbidden',
                requiredScope,
            });
        }

        return next();
    };
