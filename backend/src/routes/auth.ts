import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { Client, SearchOptions } from 'ldapts';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET || 'agent-playground-jwt-auth-secret';
const COOKIE_NAME = 'agent_auth_token';
const COOKIE_MAX_AGE = 3 * 24 * 60 * 60 * 1000; // 3 days

router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res
                .status(400)
                .json({ error: 'Username and password are required' });
        }

        const ldapUrl = process.env.LDAP_URL;
        let userProfile: {
            id: string;
            username: string;
            displayName: string;
            email: string;
            department?: string;
        } = {
            id: '',
            username: '',
            displayName: '',
            email: '',
        };

        // Dev Bypass if LDAP is not configured
        if (!ldapUrl) {
            if (username === 'admin' && password === 'admin') {
                userProfile = {
                    id: 'admin-dev-id',
                    username: 'admin',
                    displayName: 'Administrator (Dev)',
                    email: 'admin@local.dev',
                };
            } else if (username === 'testuser' && password === 'testuser') {
                userProfile = {
                    id: 'test-user-id',
                    username: 'testuser',
                    displayName: 'Test User',
                    email: 'test@local.dev',
                };
            } else {
                return res.status(401).json({
                    error: 'Invalid credentials. (Hint: use admin/admin or testuser/testuser in dev mode)',
                });
            }
        } else {
            // LDAP Authentication
            const baseDN = process.env.LDAP_BASE_DN || 'DC=CORP,DC=PEGATRON';
            const serviceAccountDN = process.env.LDAP_SERVICE_ACCOUNT_DN;
            const serviceAccountPassword =
                process.env.LDAP_SERVICE_ACCOUNT_PASSWORD;

            if (!serviceAccountDN || !serviceAccountPassword) {
                console.error(
                    'Missing LDAP_SERVICE_ACCOUNT_DN or LDAP_SERVICE_ACCOUNT_PASSWORD',
                );
                return res
                    .status(500)
                    .json({ error: 'LDAP configuration error' });
            }

            const searchFilter = (
                process.env.LDAP_USER_SEARCH_FILTER ||
                '(sAMAccountName={username})'
            ).replace('{username}', username);
            const emailAttr = process.env.LDAP_EMAIL_ATTRIBUTE || 'mail';
            const departmentAttr =
                process.env.LDAP_DEPARTMENT_ATTRIBUTE || 'department';
            const nameAttr = process.env.LDAP_NAME_ATTRIBUTE || 'name'; // Explicitly requested by user
            const displayNameAttr =
                process.env.LDAP_DISPLAY_NAME_ATTRIBUTE || 'displayName';

            const client = new Client({
                url: ldapUrl,
                timeout: 10000,
                connectTimeout: 10000,
            });

            try {
                // 1. Bind with service account
                await client.bind(serviceAccountDN, serviceAccountPassword);

                // 2. Search for user
                const { searchEntries } = await client.search(baseDN, {
                    filter: searchFilter,
                    scope: 'sub' as SearchOptions['scope'],
                    attributes: [
                        'dn',
                        emailAttr,
                        displayNameAttr,
                        nameAttr,
                        'sAMAccountName',
                        'objectGUID',
                        departmentAttr,
                    ],
                });

                if (searchEntries.length === 0) {
                    await client.unbind();
                    return res
                        .status(401)
                        .json({ error: 'User not found in directory' });
                }

                const userEntry = searchEntries[0];
                const userDN = userEntry.dn as string;
                const email = userEntry[emailAttr] as string | undefined;
                const department = userEntry[departmentAttr] as
                    | string
                    | undefined;
                // Prioritize 'name' attribute as requested, then falback to displayName
                const finalDisplayName = (userEntry[nameAttr] ||
                    userEntry[displayNameAttr] ||
                    username) as string;

                if (!userEntry.objectGUID) {
                    await client.unbind();
                    return res.status(500).json({
                        error: 'Critical LDAP Error: User is missing objectGUID, which is required for unique identification.',
                    });
                }

                const guidBuffer = Buffer.isBuffer(userEntry.objectGUID)
                    ? userEntry.objectGUID
                    : Buffer.from(userEntry.objectGUID as string, 'binary');

                const guidHex = guidBuffer.toString('hex');

                await client.unbind();

                // 3. Rebind with user credentials to verify password
                await client.bind(userDN, password);
                await client.unbind();

                // Use the official sAMAccountName from LDAP as the authoritative username
                const authoritativeUsername =
                    (userEntry.sAMAccountName as string) || username;

                userProfile = {
                    id: guidHex,
                    username: authoritativeUsername,
                    displayName: finalDisplayName,
                    email: email || 'Unknown',
                    department: department || 'Unknown',
                };
            } catch (error) {
                try {
                    await client.unbind();
                } catch (e) {}
                console.error('LDAP Authentication error:', error);
                return res
                    .status(401)
                    .json({ error: 'Invalid credentials or LDAP error' });
            }
        }

        // Generate JWT
        const token = jwt.sign({ ...userProfile }, JWT_SECRET, {
            expiresIn: '3d',
        });

        // Set HttpOnly Cookie
        res.cookie(COOKIE_NAME, token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: COOKIE_MAX_AGE,
        });

        return res.json({ user: userProfile });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error during login' });
    }
});

router.post('/logout', (req, res) => {
    res.cookie(COOKIE_NAME, '', {
        httpOnly: true,
        maxAge: 0,
    });
    res.json({ message: 'Logged out successfully' });
});

router.get('/me', (req, res) => {
    try {
        const token = req.cookies[COOKIE_NAME];
        if (!token) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const decoded = jwt.verify(token, JWT_SECRET);
        return res.json({ user: decoded });
    } catch (error) {
        // Invalid or expired token
        res.cookie(COOKIE_NAME, '', { httpOnly: true, maxAge: 0 });
        return res.status(401).json({ error: 'Session expired' });
    }
});

router.get('/search-users', requireAuth, async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || typeof q !== 'string' || q.length < 2) {
            return res.json({ users: [] });
        }

        const ldapUrl = process.env.LDAP_URL;

        // Dev Bypass
        if (!ldapUrl) {
            const mockUsers = [
                {
                    id: 'admin-dev-id',
                    username: 'admin',
                    displayName: 'Administrator (Dev)',
                    department: 'IT',
                },
                {
                    id: 'test-user-id',
                    username: 'testuser',
                    displayName: 'Test User',
                    department: 'QA',
                },
            ];
            const filtered = mockUsers.filter(
                (u) =>
                    u.id !== req.user!.id &&
                    (u.username.toLowerCase().includes(q.toLowerCase()) ||
                        u.displayName.toLowerCase().includes(q.toLowerCase())),
            );
            return res.json({ users: filtered });
        }

        // LDAP Search
        const baseDN = process.env.LDAP_BASE_DN || 'DC=CORP,DC=PEGATRON';
        const serviceAccountDN = process.env.LDAP_SERVICE_ACCOUNT_DN;
        const serviceAccountPassword =
            process.env.LDAP_SERVICE_ACCOUNT_PASSWORD;

        if (!serviceAccountDN || !serviceAccountPassword) {
            return res.status(500).json({ error: 'LDAP configuration error' });
        }

        const client = new Client({
            url: ldapUrl,
            timeout: 5000,
            connectTimeout: 5000,
        });

        try {
            await client.bind(serviceAccountDN, serviceAccountPassword);

            // Search by sAMAccountName OR displayName containing the query
            const filter = `(|(sAMAccountName=*${q}*)(cn=*${q}*)(displayName=*${q}*))`;
            const { searchEntries } = await client.search(baseDN, {
                filter,
                scope: 'sub',
                attributes: [
                    'objectGUID',
                    'sAMAccountName',
                    'displayName',
                    'name',
                    'department',
                ],
                sizeLimit: 10,
            });

            const users = searchEntries.map((entry) => {
                const guidBuffer = Buffer.isBuffer(entry.objectGUID)
                    ? entry.objectGUID
                    : Buffer.from(entry.objectGUID as string, 'binary');
                const guidHex = guidBuffer.toString('hex');

                return {
                    id: guidHex,
                    username: entry.sAMAccountName as string,
                    displayName: (entry.name ||
                        entry.displayName ||
                        entry.sAMAccountName) as string,
                    department: (entry.department || 'N/A') as string,
                };
            });

            const filteredUsers = users.filter((u) => u.id !== req.user!.id);
            await client.unbind();
            return res.json({ users: filteredUsers });
        } catch (error) {
            try {
                await client.unbind();
            } catch (e) {}
            console.error('LDAP Search error:', error);
            return res.status(500).json({ error: 'Failed to search users' });
        }
    } catch (error) {
        console.error('Search users error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
