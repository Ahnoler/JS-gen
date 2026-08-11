import * as apiOverrideDao from '../dao/api-override-dao.js';
import { API_OVERRIDE_MATCH_TYPES, API_OVERRIDE_SCOPES } from '../models/constants.js';

function assertScope(scope, scopeRefId) {
  if (!API_OVERRIDE_SCOPES.includes(scope)) {
    throw new Error(`Invalid scope: ${scope}`);
  }
  if (scope !== 'global' && (scopeRefId == null || Number.isNaN(+scopeRefId))) {
    throw new Error(`scopeRefId is required when scope is '${scope}'`);
  }
}

/**
 * Create an API override rule.
 * scope_ref_id is a logical reference — validated here, not by DB FK.
 */
export async function createOverride(input) {
  const {
    name,
    urlPattern,
    matchType = 'prefix',
    httpMethod = '',
    enabled = true,
    respStatus = 200,
    respHeaders = null,
    respBody = null,
    scope = 'global',
    scopeRefId = null,
    sortOrder = 0,
  } = input || {};

  if (!name) throw new Error('name is required');
  if (!urlPattern) throw new Error('urlPattern is required');
  if (!API_OVERRIDE_MATCH_TYPES.includes(matchType)) {
    throw new Error(`Invalid matchType: ${matchType}`);
  }
  assertScope(scope, scopeRefId);

  return apiOverrideDao.create({
    name,
    urlPattern,
    matchType,
    httpMethod,
    enabled,
    respStatus,
    respHeaders,
    respBody,
    scope,
    scopeRefId: scope === 'global' ? null : +scopeRefId,
    sortOrder,
  });
}

export async function updateOverride(id, input) {
  const existing = await apiOverrideDao.getById(id);
  if (!existing) return null;

  const patch = { ...input };
  if (patch.scope !== undefined || patch.scopeRefId !== undefined) {
    const scope = patch.scope ?? existing.scope;
    const scopeRefId = patch.scopeRefId !== undefined ? patch.scopeRefId : existing.scopeRefId;
    assertScope(scope, scopeRefId);
    patch.scope = scope;
    patch.scopeRefId = scope === 'global' ? null : +scopeRefId;
  }
  if (patch.matchType !== undefined && !API_OVERRIDE_MATCH_TYPES.includes(patch.matchType)) {
    throw new Error(`Invalid matchType: ${patch.matchType}`);
  }

  return apiOverrideDao.update(id, patch);
}

export async function getOverride(id) {
  return apiOverrideDao.getById(id);
}

export async function listOverrides(opts) {
  return apiOverrideDao.list(opts);
}

/**
 * Resolve enabled overrides for CDP Fetch.fulfillRequest at runtime.
 */
export async function listApplicableOverrides(opts) {
  return apiOverrideDao.listApplicable(opts);
}

export async function removeOverride(id) {
  return apiOverrideDao.remove(id);
}
