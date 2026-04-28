import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'agent-playground-jwt-auth-secret';
const COOKIE_NAME = 'agent_auth_token';

// Extend Express Request type to include user
declare global {
    namespace Express {
        interface Request {
            user?: {
                id: string;
                username: string;
                displayName: string;
                email: string;
                department?: string;
            }
        }
    }
}

export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
    try {
        const token = req.cookies && req.cookies[COOKIE_NAME];
        
        if (!token) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const decoded = jwt.verify(token, JWT_SECRET) as any;
        req.user = decoded;
        next();
    } catch (error) {
        // Clear invalid cookie
        res.cookie(COOKIE_NAME, '', { httpOnly: true, maxAge: 0 });
        return res.status(401).json({ error: 'Session expired or invalid' });
    }
};
