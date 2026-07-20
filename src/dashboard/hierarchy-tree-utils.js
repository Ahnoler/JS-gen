/**
 * Client-safe helpers for hierarchy trees (children[] only).
 * Keep free of Node/DB imports — used by Dashboard / record-console.
 */
import { NODE_TYPE } from '../models/hierarchy-constants.js';

/**
 * Nest flat nodes into children[] tree (no modules/functions aliases).
 * Useful if a caller still has a flat list.
 */
export function nestToChildrenTree(nodes = []) {
  const list = Array.isArray(nodes) ? nodes : [];
  const byId = new Map();
  for (const n of list) {
    byId.set(Number(n.id), { ...n, children: [] });
  }
  const roots = [];
  for (const node of byId.values()) {
    delete node.modules;
    delete node.processes;
    delete node.functions;
    const pid = node.parentId == null ? null : Number(node.parentId);
    if (pid == null || !byId.has(pid)) {
      roots.push(node);
      continue;
    }
    byId.get(pid).children.push(node);
  }
  const sortChildren = (arr) => {
    arr.sort((a, b) => (a.sortOrder - b.sortOrder) || (a.id - b.id));
    for (const c of arr) sortChildren(c.children || []);
  };
  sortChildren(roots);
  return roots;
}

/** @deprecated use nestToChildrenTree */
export function nestFlatTree(nodes = []) {
  return nestToChildrenTree(nodes);
}

/** Flatten nested children[] tree depth-first. */
export function flattenTree(nodes = [], out = []) {
  for (const n of nodes || []) {
    out.push(n);
    if (n.children?.length) flattenTree(n.children, out);
  }
  return out;
}

/**
 * Normalize API payload to a children[] tree array.
 * Accepts: nested tree, flat list, or { code, data }.
 */
export function asTree(payload) {
  let body = payload;
  if (body && typeof body === 'object' && !Array.isArray(body)
      && Object.prototype.hasOwnProperty.call(body, 'code')
      && Object.prototype.hasOwnProperty.call(body, 'data')) {
    body = body.data;
  }
  if (!Array.isArray(body)) {
    if (Array.isArray(body?.tree)) body = body.tree;
    else if (Array.isArray(body?.rows)) body = body.rows;
    else if (Array.isArray(body?.results)) body = body.results;
    else if (Array.isArray(body?.data)) body = body.data;
    else return [];
  }
  if (!body.length) return [];
  // Already nested?
  if (body.some((n) => Array.isArray(n.children))) return body;
  // Flat list → nest
  if (body.some((n) => n.parentId != null || Number(n.type) === NODE_TYPE.SYSTEM)) {
    return nestToChildrenTree(body);
  }
  return body;
}

/** @deprecated */
export function asNodeList(payload) {
  return flattenTree(asTree(payload));
}
