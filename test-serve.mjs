import { spawn } from 'child_process';

const env = {
  ...process.env,
  OPENCODE_CONFIG_CONTENT: JSON.stringify({
    provider: {
      myprovider: {
        npm: '@ai-sdk/openai-compatible',
        name: 'Ollama',
        options: {
          baseURL: 'http://218.77.58.156:3000/v1',
          apiKey: 'sk-doztyto0q15adCFi17IVjN4oQ1j6p31fLYVWkqCHgteJkDcP'
        },
        models: { 'GLM-5': { name: 'GLM-5' } }
      }
    }
  })
};

const proc = spawn(
  'C:\\nvm4w\\nodejs\\node_modules\\opencode-ai\\bin\\opencode.exe',
  ['serve', '--hostname=127.0.0.1', '--port=0', '--print-logs', '--log-level=DEBUG'],
  { env, cwd: 'D:\\dev\\opencode-skill-use' }
);

proc.stdout.on('data', d => console.log('STDOUT:', d.toString()));
proc.stderr.on('data', d => console.log('STDERR:', d.toString()));
proc.on('exit', code => { console.log('EXIT:', code); process.exit(0); });

setTimeout(() => { proc.kill(); process.exit(0); }, 8000);
