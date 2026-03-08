import { Router } from 'express';
import { modelRegistry } from '../server.js';

const router = Router();

// Endpoint to list available models
router.get('/', async (req, res) => {
    try {
        // Ensure we support multiple custom models.
        const models = modelRegistry.getAvailable();
        // Return only models under the 'custom' provider domain
        const filteredModels = models.filter((m: any) =>
            m.provider.startsWith('custom'),
        );

        res.json(
            filteredModels.map((m: any) => ({
                id: m.id,
                name: m.name,
                provider: m.provider,
                contextWindow: m.contextWindow,
            })),
        );
    } catch (err) {
        console.error('Error fetching models:', err);
        res.status(500).json({ error: 'Failed to fetch models' });
    }
});

export default router;
