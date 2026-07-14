import * as systemDao from '../dao/system-dao.js';
import * as processDao from '../dao/process-dao.js';
import * as functionDefDao from '../dao/function-def-dao.js';

/**
 * Get the full hierarchy tree: systems → processes → functions.
 * Lightweight: only id, name, and child counts.
 */
export async function getTree() {
  const systems = await systemDao.list();
  const tree = [];
  for (const sys of systems) {
    const processes = await processDao.listBySystem(sys.id);
    const processNodes = [];
    for (const proc of processes) {
      const functions = await functionDefDao.listByProcess(proc.id);
      processNodes.push({
        ...proc,
        functions: functions.map(f => ({ id: f.id, functionId: f.functionId, name: f.name })),
      });
    }
    tree.push({ ...sys, processes: processNodes });
  }
  return tree;
}

export async function createSystem(name, description) {
  // Generate UUID
  const { randomUUID } = await import('crypto');
  return systemDao.create({
    systemId: randomUUID(),
    name,
    description,
  });
}

export async function createProcess(systemId, name, description, sortOrder) {
  const { randomUUID } = await import('crypto');
  return processDao.create({
    processId: randomUUID(),
    systemId,
    name,
    description,
    sortOrder,
  });
}

export async function createFunction(processId, name, description, sortOrder) {
  const { randomUUID } = await import('crypto');
  return functionDefDao.create({
    functionId: randomUUID(),
    processId,
    name,
    description,
    sortOrder,
  });
}
