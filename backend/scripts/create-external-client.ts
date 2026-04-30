import crypto from 'crypto';
import type { Mongoose } from 'mongoose';

type ParsedArgs = {
    options: Record<string, string>;
    flags: Set<string>;
};

const FLAGS = new Set(['help', 'dry-run', 'upsert-binding']);
const OPTIONS = new Set([
    'agent-id',
    'client-id',
    'client-name',
    'expires-at',
    'model-id',
    'model-provider',
    'prefix',
    'system-id',
    'system-name',
]);

function printHelp() {
    console.log(`Create an external API client and bind it to an agent.

Usage:
  pnpm --dir backend run external:create-client -- \\
    --client-id <client-id> \\
    --system-id <system-id> \\
    --agent-id <agent-id> \\
    --model-provider <provider> \\
    --model-id <model-id> \\
    [--client-name <name>] \\
    [--prefix <api-key-prefix>] \\
    [--expires-at <iso-date>] \\
    [--system-name <name>] \\
    [--upsert-binding] \\
    [--dry-run]

Examples:
  MONGODB_URI=mongodb://localhost:27017/agent-playground \\
  pnpm --dir backend run external:create-client -- \\
    --client-id aicc-portal-faq-client \\
    --client-name "AICC Portal FAQ" \\
    --system-id aicc-portal-faq \\
    --prefix aicc-portal-faq \\
    --agent-id admin--aicc-portal-chatbot-agent \\
    --model-provider custom \\
    --model-id qwen3:8b

Notes:
  - Normal execution writes both externalapiclients and externalsystembindings.
  - The generated plaintext API key is printed once and is not stored.
  - MongoDB stores only sha256(full API key).
  - If a binding already exists, pass --upsert-binding to update it.
`);
}

function parseArgs(argv: string[]): ParsedArgs {
    const options: Record<string, string> = {};
    const flags = new Set<string>();

    for (let i = 0; i < argv.length; i += 1) {
        const raw = argv[i];
        if (raw === '--') {
            continue;
        }

        if (!raw.startsWith('--')) {
            throw new Error(`Unexpected argument: ${raw}`);
        }

        const key = raw.slice(2);
        if (FLAGS.has(key)) {
            flags.add(key);
            continue;
        }

        if (!OPTIONS.has(key)) {
            throw new Error(`Unknown option: --${key}`);
        }

        const value = argv[i + 1];
        if (!value || value.startsWith('--')) {
            throw new Error(`Missing value for --${key}`);
        }

        options[key] = value;
        i += 1;
    }

    return { options, flags };
}

function requireOption(
    options: Record<string, string>,
    key: string,
): string {
    const value = options[key]?.trim();
    if (!value) {
        throw new Error(`Missing required option: --${key}`);
    }
    return value;
}

function optionalOption(
    options: Record<string, string>,
    key: string,
): string | undefined {
    const value = options[key]?.trim();
    return value || undefined;
}

function sanitizePrefix(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-+/g, '-');
}

function validatePrefix(prefix: string) {
    if (!/^[a-z0-9-]+$/.test(prefix)) {
        throw new Error(
            '--prefix must contain only lowercase letters, numbers, and hyphens',
        );
    }
    if (prefix.includes('_')) {
        throw new Error('--prefix cannot contain underscores');
    }
}

function parseExpiresAt(value?: string): Date | undefined {
    if (!value) return undefined;
    const expiresAt = new Date(value);
    if (Number.isNaN(expiresAt.getTime())) {
        throw new Error('--expires-at must be a valid ISO date');
    }
    return expiresAt;
}

function sha256Hex(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function generateApiKey(prefix: string): string {
    return `apg_${prefix}_${crypto.randomBytes(32).toString('hex')}`;
}

let activeMongoose: Mongoose | undefined;

async function main() {
    const { options, flags } = parseArgs(process.argv.slice(2));

    if (flags.has('help')) {
        printHelp();
        return;
    }

    const clientId = requireOption(options, 'client-id');
    const systemId = requireOption(options, 'system-id');
    const clientName = optionalOption(options, 'client-name');
    const systemName = optionalOption(options, 'system-name');
    const prefix = optionalOption(options, 'prefix') || sanitizePrefix(systemId);
    const expiresAt = parseExpiresAt(optionalOption(options, 'expires-at'));
    const agentId = requireOption(options, 'agent-id');
    const modelProvider = requireOption(options, 'model-provider');
    const modelId = requireOption(options, 'model-id');
    const dryRun = flags.has('dry-run');
    const upsertBinding = flags.has('upsert-binding');

    validatePrefix(prefix);

    const apiKey = generateApiKey(prefix);
    const apiKeyHash = sha256Hex(apiKey);
    const mongoUri =
        process.env.MONGODB_URI || 'mongodb://localhost:27017/agent-playground';
    let mongoose: Mongoose | undefined;

    if (!dryRun) {
        const mongooseModule = await import('mongoose');
        const models = await import('../src/models/ExternalIntegration.js');
        mongoose = mongooseModule.default;
        activeMongoose = mongoose;
        const { ExternalApiClient, ExternalSystemBinding } = models;

        await mongoose.connect(mongoUri);

        const existingClient = await ExternalApiClient.findOne({
            $or: [{ clientId }, { apiKeyPrefix: prefix }],
        });
        if (existingClient) {
            throw new Error(
                `External API client already exists for clientId or prefix: ${existingClient.clientId}`,
            );
        }

        const existingBinding = await ExternalSystemBinding.findOne({
            systemId,
        });

        if (existingBinding && !upsertBinding) {
            throw new Error(
                `External system binding already exists for systemId ${systemId}. Pass --upsert-binding to update it.`,
            );
        }

        await ExternalApiClient.create({
            clientId,
            clientName,
            systemId,
            apiKeyPrefix: prefix,
            apiKeyHash,
            status: 'active',
            scopes: ['chat:stream'],
            expiresAt,
        });

        await ExternalSystemBinding.findOneAndUpdate(
            { systemId },
            {
                $set: {
                    systemId,
                    systemName,
                    agentId,
                    modelProvider,
                    modelId,
                    status: 'active',
                },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true },
        );
    }

    console.log(dryRun ? 'DRY RUN - no database writes performed.' : 'Done.');
    console.log('');
    console.log('ExternalApiClient');
    console.log(`- clientId: ${clientId}`);
    console.log(`- clientName: ${clientName || 'N/A'}`);
    console.log(`- systemId: ${systemId}`);
    console.log(`- apiKeyPrefix: ${prefix}`);
    console.log('- scopes: chat:stream');
    console.log(`- expiresAt: ${expiresAt?.toISOString() || 'N/A'}`);

    console.log('');
    console.log('ExternalSystemBinding');
    console.log(`- systemId: ${systemId}`);
    console.log(`- systemName: ${systemName || 'N/A'}`);
    console.log(`- agentId: ${agentId}`);
    console.log(`- model: ${modelProvider}/${modelId}`);
    console.log(`- mode: ${upsertBinding ? 'upsert' : 'create'}`);

    console.log('');
    console.log('API Key');
    console.log(apiKey);
    console.log('');
    console.log(
        'Store this plaintext key now. It is not stored in MongoDB and cannot be recovered.',
    );
    return mongoose;
}

main()
    .then(() => undefined)
    .catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    })
    .finally(async () => {
        if (activeMongoose?.connection.readyState !== 0) {
            await activeMongoose?.disconnect();
        }
    });
