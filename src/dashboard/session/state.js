// Session mode shared state: storage keys, phase descriptions, context bag

export const HIER_STORAGE_KEY = 'jsgen.selectedFunctionId';
export const TRAJ_STORAGE_KEY = 'jsgen.selectedTrajectoryId';
export const PHASE_STORAGE_KEY = 'jsgen.selectedPhaseId';
export const PHASE_DESC_STORAGE_KEY = 'jsgen.phaseDescriptions';

export function loadPhaseDescriptions() {
  try {
    const raw = sessionStorage.getItem(PHASE_DESC_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') window.__phaseDescriptions__ = parsed;
    }
  } catch {}
  if (!window.__phaseDescriptions__) window.__phaseDescriptions__ = {};
}

export function persistPhaseDescriptions() {
  try {
    sessionStorage.setItem(PHASE_DESC_STORAGE_KEY, JSON.stringify(window.__phaseDescriptions__ || {}));
  } catch {}
}

/** Collect all session-tab DOM refs used across submodules. */
export function collectSessionDom() {
  return {
    sessNewBtn: document.getElementById('sessNewBtn'),
    sessLoadBtn: document.getElementById('sessLoadBtn'),
    sessStepBtn: document.getElementById('sessStepBtn'),
    sessTrajBtn: document.getElementById('sessTrajBtn'),
    sessResetTrajBtn: document.getElementById('sessResetTrajBtn'),
    sessCaseDataBtn: document.getElementById('sessCaseDataBtn'),
    sessCancelBtn: document.getElementById('sessCancelBtn'),
    sessTask: document.getElementById('sessTask'),
    sessModel: document.getElementById('sessModel'),
    sessMaxSteps: document.getElementById('sessMaxSteps'),
    sessActive: document.getElementById('sessActive'),
    sessStatus: document.getElementById('sessStatus'),
    sessTimeline: document.getElementById('sessTimeline'),
    sessStepCount: document.getElementById('sessStepCount'),
    sessTrajectoryId: document.getElementById('sessTrajectoryId'),
    sessTrajPath: document.getElementById('sessTrajPath'),
    exploreLogTerminal: document.getElementById('exploreLogTerminal'),
    sessCloseBrowserBtn: document.getElementById('sessCloseBrowserBtn'),
    sessUploadBtn: document.getElementById('sessUploadBtn'),
    sessFileInput: document.getElementById('sessFileInput'),
    sessFileName: document.getElementById('sessFileName'),
    sessLoginToggle: document.getElementById('sessLoginToggle'),
    sessLoginSection: document.getElementById('sessLoginSection'),
    sessLoginUrl: document.getElementById('sessLoginUrl'),
    sessLoginUser: document.getElementById('sessLoginUser'),
    sessLoginPass: document.getElementById('sessLoginPass'),
    sessLoginBtn: document.getElementById('sessLoginBtn'),
    sessLoginSystem: document.getElementById('sessLoginSystem'),
    sessLoginAccount: document.getElementById('sessLoginAccount'),
    sessLoginRemark: document.getElementById('sessLoginRemark'),
    quickActionSelect: document.getElementById('sessQuickAction'),
    quickParam1: document.getElementById('sessQuickParam1'),
    quickParam2: document.getElementById('sessQuickParam2'),
    quickExecBtn: document.getElementById('sessQuickExecBtn'),
    quickResult: document.getElementById('sessQuickResult'),
    watcherStatus: document.getElementById('sessWatcherStatus'),
    manualRecBtn: document.getElementById('sessManualRecBtn'),
    manualRecStatus: document.getElementById('sessManualRecStatus'),
    autoPersistInput: document.getElementById('sessAutoPersist'),
    autoPersistTrack: document.getElementById('sessAutoPersistTrack'),
    autoPersistThumb: document.getElementById('sessAutoPersistThumb'),
    sessListCard: document.getElementById('sessListCard'),
    sessListBody: document.getElementById('sessListBody'),
    sessListEmpty: document.getElementById('sessListEmpty'),
    sessListCount: document.getElementById('sessListCount'),
    sessHierSystem: document.getElementById('sessHierSystem'),
    sessHierProcess: document.getElementById('sessHierProcess'),
    sessHierFunction: document.getElementById('sessHierFunction'),
    sessTrajectorySelect: document.getElementById('sessTrajectorySelect'),
    sessPhaseSelect: document.getElementById('sessPhaseSelect'),
    sessNewTrajBtn: document.getElementById('sessNewTrajBtn'),
  };
}

/**
 * Mutable session context shared by wire* modules.
 * Method slots (sessLog, executeSessionStep, …) are filled by wire* calls.
 */
export function createSessionContext(dom) {
  return {
    ...dom,
    sessAbortController: null,
    sessRunning: false,
    sessionPhases: [],
    interventionFields: [],
    manualRecording: false,
    autoPersist: false,
    hierTree: [],
    loginHierTree: [],
  };
}

export function getSelectedFunctionId(ctx) {
  const raw = ctx.sessHierFunction?.value;
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function getSelectedTrajectoryDbId(ctx) {
  const raw = ctx.sessTrajectorySelect?.value;
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function getSelectedPhaseId(ctx) {
  const raw = ctx.sessPhaseSelect?.value;
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
