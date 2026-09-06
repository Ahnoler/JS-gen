/**
 * API override rule service: CRUD + runtime resolution for CDP Fetch.fulfillRequest.
 */
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
 * @param {object} input override fields
 * @param {string} input.name rule name
 * @param {string} input.urlPattern URL pattern to match
 * @param {string} [input.matchType] match type (prefix/exact/regex)
 * @param {string} [input.httpMethod] HTTP method filter (empty = any)
 * @param {boolean} [input.enabled] whether the rule is active
 * @param {number} [input.respStatus] response status code
 * @param {object} [input.respHeaders] response headers JSON
 * @param {string} [input.respBody] response body
 * @param {string} [input.scope] scope (global/trajectory/function)
 * @param {number|null} [input.scopeRefId] logical reference id for non-global scope
 * @param {number} [input.sortOrder] sort order
 * @returns {Promise<object>} created override row
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

/**
 * Update an existing override; re-validates scope/matchType when patched.
 * @param {number} id override id
 * @param {object} input partial override fields to patch
 * @returns {Promise<object|null>} updated row, or null if not found
 */
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

/**
 * Get a single override by id.
 * @param {number} id override id
 * @returns {Promise<object|null>} override row or null
 */
export async function getOverride(id) {
  return apiOverrideDao.getById(id);
}

/**
 * List overrides with optional filter.
 * @param {object} [opts] filter/pagination options
 * @returns {Promise<object[]>} override rows
 */
export async function listOverrides(opts) {
  return apiOverrideDao.list(opts);
}

/**
 * Resolve enabled overrides for CDP Fetch.fulfillRequest at runtime.
 * @param {object} opts scope filter (scope/scopeRefId)
 * @returns {Promise<object[]>} applicable enabled override rows
 */
export async function listApplicableOverrides(opts) {
  return apiOverrideDao.listApplicable(opts);
}

/**
 * Delete an override by id.
 * @param {number} id override id
 * @returns {Promise<number>} rows deleted
 */
export async function removeOverride(id) {
  return apiOverrideDao.remove(id);
}
