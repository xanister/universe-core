import { existsSync } from 'fs';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';

function findMonorepoRoot(startDir: string): string {
  let dir = startDir;
  for (;;) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return startDir;
    dir = parent;
  }
}

// Load .env from monorepo root
dotenv.config({ path: resolve(findMonorepoRoot(process.cwd()), '.env') });

function requireEnv(name: string, ...fallbacks: string[]): string {
  for (const fb of [name, ...fallbacks]) {
    const val = process.env[fb];
    if (val) return val;
  }
  throw new Error(
    `${name} is not set (also checked: ${fallbacks.join(', ')}). Add it to the root .env file.`,
  );
}

function parseLlmProvider(value: string | undefined): 'openai' | 'claude' {
  if (value === 'claude') return 'claude';
  return 'openai';
}

const isTest = process.env.NODE_ENV === 'test';

export const config = {
  port:
    process.env.API_PORT || process.env.PORT || (isTest ? '3210' : requireEnv('API_PORT', 'PORT')),
  frontendUrl:
    process.env.FRONTEND_URL || (isTest ? 'http://localhost:3100' : requireEnv('FRONTEND_URL')),
  nodeEnv: process.env.NODE_ENV || 'development',
  openaiApiKey: process.env.OPENAI_API_KEY,
  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY,

  awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID,
  awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  awsRegion: process.env.AWS_REGION || 'us-east-1',
  awsS3Bucket: process.env.AWS_S3_BUCKET,
  awsCdnUrl: process.env.AWS_CDN_URL,

  llmProvider: parseLlmProvider(process.env.LLM_PROVIDER),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
};
