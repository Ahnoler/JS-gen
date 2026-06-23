import { writeFileSync, readFileSync, existsSync, readdirSync, statSync } from 'fs';
import path from 'path';
import os from 'os';
import { PROJECT_DIR, GENERATED_DIR, STANDALONE_LLM } from '../config.js';
import { state } from '../state.js';
import { callLLM } from '../llm-utils.js';
import {
  buildScriptPrompt, parseScriptFromResponse, generateUniqueFileName,
  ensureGeneratedDir, loadGeneratedIndex, saveGeneratedIndex, parseTrajectoryTable,
  buildPhasePrompt, splitIntoPhases, assemblePhasedScript,
} from '../script-utils.js';

function applyModel(promptParams, model) {
  if (model) {
    promptParams.model = typeof model === 'string'
      ? { providerID: model.split('/')[0], modelID: model.split('/')[1] || model }
      : model;
  } else if (state.defaultModel) {
    promptParams.model = state.defaultModel;
  }
}

const jobs = new Map();

function extractCode(parts) {
  // 1. Agent wrote a file via tool → read it from disk
  for (const p of (parts || [])) {
    if (p.type === 'tool_use') {
      const fp = p.input?.file_path || p.input?.path || p.input?.file || '';
      if (fp && /\.js$/.test(fp)) {
        const absPath = path.resolve(PROJECT_DIR, fp);
        if (existsSync(absPath)) {
          try { return readFileSync(absPath, 'utf-8'); } catch {}
        }
      }
    }
  }

  // 2. Scan text output for "Wrote / 已写入 / 已生成至 xxx.js"
  const allText = parts?.filter(p => p.type === 'text').map(p => p.text).join('\n') || '';
  const refs = allText.match(/(?:Wrote|Written|写入|已写入|已生成至|保存到)\s+(.+?\.js)/gi) || [];
  for (const ref of refs) {
    const m = ref.match(/(.+?\.js)/);
    if (m) {
      const absPath = path.resolve(PROJECT_DIR, m[1]);
      if (existsSync(absPath)) {
        try { return readFileSync(absPath, 'utf-8'); } catch {}
      }
    }
  }

  // 3. Parse code from text
  const { code } = parseScriptFromResponse(allText);
  if (code) return code;

  // 4. Scan project root + opencode temp dir for recently-written .js files
  const scanDirs = [PROJECT_DIR, path.join(os.tmpdir(), 'opencode')];
  for (const dir of scanDirs) {
    try {
      if (!existsSync(dir)) continue;
      const files = readdirSync(dir).filter(f => /\.js$/.test(f));
      let latestFile = null, latestTime = 0;
      for (const f of files) {
        try {
          const st = statSync(path.join(dir, f));
          if (st.mtimeMs > Date.now() - 180000 && st.mtimeMs > latestTime) {
            latestTime = st.mtimeMs;
            latestFile = path.join(dir, f);
          }
        } catch {}
      }
      if (latestFile && existsSync(latestFile)) {
        const content = readFileSync(latestFile, 'utf-8');
        if (/const\s*\{\s*chromium\s*\}\s*=\s*require/.test(content)) return content;
      }
    } catch {}
  }

  return allText || '';
}

async function runGeneration({ description, url, credentials, sessionId, model, trajectoryTable }) {
  let code, steps;

  // Priority 1: Per-phase LLM generation from trajectory (short prompts → focused LLM)
  if (trajectoryTable) {
    const rows = parseTrajectoryTable(trajectoryTable);
    if (rows && rows.length > 0) {
      const phases = splitIntoPhases(rows);
      if (phases.length > 0) {
        console.log('[generate] Split into ' + phases.length + ' phases');

        const phaseCodeBlocks = [];
        let allPhaseSteps = [];

        for (let p = 0; p < phases.length; p++) {
          const phasePrompt = buildPhasePrompt({
            phaseIndex: p,
            totalPhases: phases.length,
            phaseActions: phases[p],
            testScenario: description,
          });

          console.log(`[generate] Phase ${p + 1}/${phases.length}: sending ${phases[p].length} actions to LLM`);
          let phaseCode = '';

          if (STANDALONE_LLM) {
            phaseCode = await callLLM(phasePrompt, model);
          } else {
            const { data: phaseSession, error: createErr } = await state.client.session.create({
              directory: PROJECT_DIR,
              title: `Phase ${p + 1}/${phases.length}: ${(description || '').slice(0, 60)}`,
              agent: 'build',
            });
            if (createErr) throw new Error(createErr?.message || JSON.stringify(createErr));

            const pp = {
              sessionID: phaseSession.id,
              directory: PROJECT_DIR,
              agent: 'build',
              parts: [{ type: 'text', text: phasePrompt }],
            };
            applyModel(pp, model);
            const { data: result, error: promptErr } = await state.client.session.prompt(pp);
            if (promptErr) throw new Error(promptErr?.message || JSON.stringify(promptErr));
            phaseCode = (result?.parts || []).filter(p => p.type === 'text').map(p => p.text).join('\n');

            state.client.session.delete({ sessionID: phaseSession.id, directory: PROJECT_DIR }).catch(() => {});
          }

          // Strip markdown code fences if present
          const codeMatch = phaseCode.match(/```(?:javascript)?\s*([\s\S]*?)```/);
          if (codeMatch) phaseCode = codeMatch[1].trim();
          phaseCodeBlocks.push(phaseCode);
          allPhaseSteps.push({ phase: p + 1, actions: phases[p].length });
          console.log(`[generate] Phase ${p + 1} done (${phaseCode.split('\n').length} lines)`);
        }

        code = assemblePhasedScript(phaseCodeBlocks, url);
        steps = allPhaseSteps.map(s => ({ step: s.phase, action: `Phase ${s.phase} (${s.actions} actions)` }));
        console.log('[generate] Assembled ' + phases.length + ' phases (' + code.split('\n').length + ' lines)');
      }
    }
  }

  // Priority 2: LLM-based generation from scratch (no trajectory)
  if (!code) {
    const genPrompt = buildScriptPrompt({ description, url, credentials });

    if (STANDALONE_LLM) {
      const text = await callLLM(genPrompt, model);
      const parsed = parseScriptFromResponse(text);
      code = parsed.code;
      steps = parsed.steps;
      if (!code) code = text;
    } else {
      const promptParams = {
        sessionID: sessionId,
        directory: PROJECT_DIR,
        agent: 'build',
        parts: [{ type: 'text', text: genPrompt }],
      };
      applyModel(promptParams, model);

      const { data: result, error: promptErr } = await state.client.session.prompt(promptParams);
      if (promptErr) throw new Error(promptErr?.message || JSON.stringify(promptErr));

      let allText = (result?.parts || []).filter(p => p.type === 'text').map(p => p.text).join('\n') || '';
      let parsed = parseScriptFromResponse(allText);
      code = parsed.code;
      steps = parsed.steps;

      try {
        const { data: messages } = await state.client.session.messages({ sessionID: sessionId, directory: PROJECT_DIR });
        if (messages && messages.length) {
          const texts = messages.filter(m => (m.message?.role || m.info?.role) === 'assistant').flatMap(m => (m.parts || []).filter(p => p.type === 'text').map(p => p.text));
          const longest = texts.sort((a, b) => b.length - a.length)[0] || '';
          if (longest.length > allText.length) {
            allText = longest;
            const parsed2 = parseScriptFromResponse(longest);
            if (parsed2.code && parsed2.code.split('\n').length > (code?.split('\n').length || 0)) {
              code = parsed2.code;
              steps = parsed2.steps;
            }
          }
        }
      } catch (e) {
        console.log('[generate] Fallback messages fetch failed:', e.message);
      }
    }
  }

  const now = new Date();
  const fileName = generateUniqueFileName();
  const filePath = path.join(GENERATED_DIR, fileName);
  ensureGeneratedDir();
  writeFileSync(filePath, code, 'utf-8');

  const testId = 'test_' + Date.now();
  const list = loadGeneratedIndex();
  list.unshift({
    testId, fileName, description, url: url || '', sessionId,
    createdAt: now.toISOString(), updatedAt: now.toISOString(), steps,
  });
  saveGeneratedIndex(list);

  console.log('[generate] Script saved:', fileName, '(' + code.split('\n').length + ' lines)');
  return { testId, fileName, script: code, steps, sessionId };
}

export default function (app) {

  app.post('/api/test/generate', async (req, res) => {
    const { description, url, credentials, sessionId: existingSessionId, model, trajectoryTable } = req.body;
    if (!description) return res.status(400).json({ error: 'description is required' });
    if (!state.client && !STANDALONE_LLM) return res.status(503).json({ error: 'opencode server not ready' });

    let sessionId = existingSessionId || null;
    const ownSession = !existingSessionId;

    try {
      if (ownSession && !STANDALONE_LLM) {
        const { data: session, error: createErr } = await state.client.session.create({
          directory: PROJECT_DIR,
          title: `Generate: ${description.slice(0, 60)}`,
          agent: 'build',
        });
        if (createErr) return res.status(500).json({ error: createErr?.message || JSON.stringify(createErr) });
        sessionId = session.id;
      }

      const promise = runGeneration({ description, url, credentials, sessionId, model, trajectoryTable });
      jobs.set(sessionId, { promise, ownSession });
      
      promise
        .then(value => {
          for (const [id, job] of jobs) {
            if (job.result) jobs.delete(id);
          }
          const job = jobs.get(sessionId);
          if (job) {
            job.result = { value };
          }
        })
        .catch(err => {
          for (const [id, job] of jobs) {
            if (job.result) jobs.delete(id);
          }
          const job = jobs.get(sessionId);
          if (job) {
            job.result = { error: err.message };
            if (job.ownSession && !STANDALONE_LLM) {
              state.client.session.delete({ sessionID: sessionId, directory: PROJECT_DIR }).catch(() => {});
            }
          }
        });
      
      res.json({ sessionId, status: 'generating' });
    } catch (err) {
      if (ownSession && sessionId && !STANDALONE_LLM) state.client.session.delete({ sessionID: sessionId, directory: PROJECT_DIR }).catch(() => {});
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/test/refine', async (req, res) => {
    const { testId, feedback, model } = req.body;
    if (!testId || !feedback) return res.status(400).json({ error: 'testId and feedback are required' });
    if (!state.client && !STANDALONE_LLM) return res.status(503).json({ error: 'opencode server not ready' });

    const list = loadGeneratedIndex();
    const entry = list.find(e => e.testId === testId);
    if (!entry) return res.status(404).json({ error: 'Test not found' });

    const sessionId = entry.sessionId;

    try {
      const refinePrompt = `Modify the previous script based on the feedback below. Output ONLY the complete updated script.

Feedback:
${feedback}

## Rules
1. Output the ENTIRE fixed script, not just the changed portion
2. Keep \`context.addInitScript\` CTRL injection
3. All Element UI operations must use \`page.evaluate(() => CTRL.xxx())\`
4. \`save_case_data\` → \`const\`; \`read_case_data\` → reference that variable
5. Add proper waits before interacting with elements
6. Use \`translate(.," ","")\` in XPaths for Chinese text
7. For el-table rows, use \`.el-table__row\` class selector`;

      let code, steps;

      if (STANDALONE_LLM) {
        const text = await callLLM(refinePrompt, model);
        const parsed = parseScriptFromResponse(text);
        code = parsed.code;
        steps = parsed.steps;
        if (!code) code = text;
      } else {
        const promptParams = {
          sessionID: sessionId,
          directory: PROJECT_DIR,
          agent: 'build',
          parts: [{ type: 'text', text: refinePrompt }],
        };
        applyModel(promptParams, model);

        const { data: result, error: promptErr } = await state.client.session.prompt(promptParams);
        if (promptErr) throw new Error(promptErr?.message || JSON.stringify(promptErr));

        let allText = (result?.parts || []).filter(p => p.type === 'text').map(p => p.text).join('\n') || '';
        let parsed = parseScriptFromResponse(allText);
        code = parsed.code;
        steps = parsed.steps;

        try {
          const { data: messages } = await state.client.session.messages({ sessionID: sessionId, directory: PROJECT_DIR });
          if (messages && messages.length) {
            const texts = messages.filter(m => (m.message?.role || m.info?.role) === 'assistant').flatMap(m => (m.parts || []).filter(p => p.type === 'text').map(p => p.text));
            const longest = texts.sort((a, b) => b.length - a.length)[0] || '';
            if (longest.length > allText.length) {
              allText = longest;
              const parsed2 = parseScriptFromResponse(longest);
              if (parsed2.code && parsed2.code.split('\n').length > (code?.split('\n').length || 0)) {
                code = parsed2.code;
                steps = parsed2.steps;
              }
            }
          }
        } catch (e) {
          console.log('[refine] Fallback messages fetch failed:', e.message);
        }
      }

      const oldPath = path.join(GENERATED_DIR, entry.fileName);
      try { if (existsSync(oldPath)) writeFileSync(oldPath, code, 'utf-8'); } catch {}

      const now = new Date();
      entry.updatedAt = now.toISOString();
      entry.steps = steps;
      saveGeneratedIndex(list);

      console.log('[refine] Script updated:', entry.fileName, '(' + code.split('\n').length + ' lines)');
      res.json({ testId: entry.testId, fileName: entry.fileName, script: code, steps, sessionId });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/test/generate/:sessionId/status', (req, res) => {
    const { sessionId } = req.params;
    const job = jobs.get(sessionId);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    if (job.result) {
      const result = job.result;
      jobs.delete(sessionId);
      if (result.error) {
        return res.json({ status: 'failed', error: result.error });
      } else {
        return res.json({ status: 'done', ...result.value });
      }
    }

    res.json({ status: 'generating' });
  });
}
