import { DefaultResourceLoader } from 'pi-coding-agent';
import path from 'path';

async function main() {
    const baseAgentDir = path.resolve(__dirname);
    const activeAgentDir = path.resolve(baseAgentDir, 'agents', 'dummy-km-agent');
    
    const resourceLoader = new DefaultResourceLoader({
        cwd: process.cwd(),
        agentDir: activeAgentDir,
        additionalSkillPaths: [path.join(baseAgentDir, 'skills')],
    });
    
    await resourceLoader.reload();
    console.log("Skills:", resourceLoader.getSkillConfigs().map(s => s.name));
}

main().catch(console.error);
