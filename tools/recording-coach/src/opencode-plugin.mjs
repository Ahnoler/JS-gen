/**
 * OpenCode plugin factory for recording-coach tools.
 * Prefer @opencode-ai/plugin `tool` helper when available; otherwise export
 * plain descriptors for CLI / fallback registration.
 *
 * @param {{ evidenceDir: string, baseUrl?: string }} opts
 */
export async function createCoachPlugin(opts) {
  const { createTools } = await import('./tools.mjs');
  const tools = createTools(opts);

  let toolHelper = null;
  try {
    const mod = await import('@opencode-ai/plugin');
    toolHelper = mod.tool;
  } catch {
    toolHelper = null;
  }

  const defs = {
    mark_inputs_ready: {
      description:
        'Mark CollectInputs complete; advance to ReadyToCreate. taskText must be business gate (【硬性成功门闩, ≥80 chars, no curl/API steps).',
      args: {
        goal: { type: 'string' },
        functionId: { type: 'number' },
        systemAccountId: { type: 'number' },
        taskText: { type: 'string' },
        assert: { type: 'object' },
        businessProbeRequired: { type: 'boolean' },
        productLabel: { type: 'string' },
      },
    },
    save_dispatch_brief: {
      description:
        'Validate and save dispatch-brief.md (five headings). CollectInputs or ReadyToCreate; does not advance phase.',
      args: {
        text: { type: 'string' },
      },
    },
    preflight_readonly: {
      description:
        'ReadyToCreate only: list_executors + GET probes under /api/v2/. Sets preflight.ok.',
      args: {
        probes: { type: 'array' },
      },
    },
    accept_phases: {
      description:
        'ReadyToCreate only: read analyze.json phases into acceptedPhases (1–10, description ≥20 chars).',
      args: {},
    },
    list_executors: {
      description: 'GET /api/v2/executors — check connected/inUse before prepare',
      args: {},
    },
    get_trajectory: {
      description: 'GET trajectory summary (or full if summary=false)',
      args: {
        trajectoryId: { type: 'number' },
        summary: { type: 'boolean' },
      },
    },
    analyze_trajectory: {
      description: 'POST analyze — description + functionId → phases',
      args: {
        description: { type: 'string' },
        functionId: { type: 'number' },
      },
    },
    create_trajectory: {
      description:
        'Create traj using acceptedPhases (requires dispatch brief, preflight, accept_phases); advances to Created',
      args: {
        name: { type: 'string' },
        task: { type: 'string' },
        functionId: { type: 'number' },
        systemAccountId: { type: 'number' },
      },
    },
    prepare_record: {
      description: 'POST record/prepare (timeout ≥600s); advances to Prepared',
      args: { trajectoryId: { type: 'number' } },
    },
    cdp_precheck: {
      description:
        'Prepared only: CDP close known blocking dialogs on wf.cdpPort; sets cdpChecked and writes cdp-precheck.json',
      args: {
        needles: { type: 'array' },
      },
    },
    start_record: {
      description: 'Strategy A: long POST record/start + poll progress.log; advances Recording→Settled',
      args: {
        trajectoryId: { type: 'number' },
        phaseIds: { type: 'array' },
        timeoutMs: { type: 'number' },
      },
    },
    detach_trajectory: {
      description: 'POST detach — free executor slot',
      args: { trajectoryId: { type: 'number' } },
    },
    assert_steps: {
      description: 'Rule assert on MySQL steps; writes verdict.txt; advances to Done',
      args: { criteria: { type: 'object' } },
    },
    write_evidence_summary: {
      description: 'Write summary.txt into evidenceDir',
      args: { text: { type: 'string' } },
    },
    retry_new_traj: {
      description: 'Clear trajectoryId; back to ReadyToCreate (same OpenCode session)',
      args: {},
    },
    write_through_report: {
      description:
        'Phase Done only: GET trajectory, write through-report.md + close.txt. ' +
        'Your final chat message must be byte-identical to closeMessage — no extra step counts or commentary.',
      args: {},
    },
  };

  /** @type {Record<string, any>} */
  const toolMap = {};

  for (const [name, meta] of Object.entries(defs)) {
    const execute = async (args) => {
      try {
        const result = await tools.call(name, args || {});
        return JSON.stringify(result);
      } catch (e) {
        return JSON.stringify({ ok: false, error: String(e.message || e) });
      }
    };

    if (toolHelper) {
      const argSchema = {};
      for (const [k, v] of Object.entries(meta.args || {})) {
        let s = toolHelper.schema.any?.() ?? toolHelper.schema.string().optional();
        if (v.type === 'string') s = toolHelper.schema.string().optional();
        else if (v.type === 'number') s = toolHelper.schema.number().optional();
        else if (v.type === 'boolean') s = toolHelper.schema.boolean().optional();
        else if (v.type === 'object') s = toolHelper.schema.object({}).passthrough().optional();
        else if (v.type === 'array') s = toolHelper.schema.array(toolHelper.schema.any()).optional();
        argSchema[k] = s.describe?.(k) ?? s;
      }
      toolMap[name] = toolHelper({
        description: meta.description,
        args: argSchema,
        execute,
      });
    } else {
      toolMap[name] = { description: meta.description, args: meta.args, execute };
    }
  }

  const plugin = async () => ({ tool: toolMap });
  return { plugin, tools, toolMap, hasPluginHelper: Boolean(toolHelper) };
}
