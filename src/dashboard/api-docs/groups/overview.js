/**
 * API group(s): overview, system-mgmt — extracted from catalog.js.
 * Keep in sync with src/routes/v2/*.js
 */

/** @typedef {{ name: string, type: string, required?: boolean, in?: 'path'|'query'|'body', desc: string, example?: string }} Param */
/** @typedef {{ method: string, path: string, summary: string, desc?: string, params?: Param[], reqExample?: string, respExample?: string, notes?: string[], deprecated?: boolean, tryable?: boolean }} Endpoint */
/** @typedef {{ id: string, name: string, description: string, endpoints: Endpoint[] }} TagGroup */

import { J } from './_j.js';

/** @type {TagGroup[]} */
export const GROUP_OVERVIEW = [
  {
    id: 'overview',
    name: '概览',
    description: '产品前端对接约定与推荐流程',
    endpoints: [],
  },
  {
    id: 'system-mgmt',
    name: '系统管理',
    description: '系统 → 模块 → 功能（children[] 嵌套树）',
    endpoints: [
      {
        method: 'GET', path: '/api/v2/system-mgmt/tree',
        summary: '系统树（以 id=0 根为顶层）',
        desc: 'data 恒为 [{ id:0, type:0, children:[系统…] }]。支持 name / type 筛选；无命中时 children 为空数组。命中节点可带 path（不含根名）。',
        params: [
          { name: 'name', type: 'string', in: 'query', desc: '名称模糊关键词', example: '客户' },
          { name: 'type', type: 'number', in: 'query', desc: '1 系统 / 2 模块 / 3 功能', example: '3' },
          { name: 'limit', type: 'number', in: 'query', desc: '有关键词时默认 50，最大 500', example: '50' },
          { name: 'accounts', type: 'string', in: 'query', desc: '传 0/false 时不含账号', example: '0' },
        ],
        respExample: J({
          code: 200,
          message: 'ok',
          data: [
            {
              id: 0, type: 0, typeLabel: '根', name: '根', parentId: 0,
              children: [
                {
                  id: 1, type: 1, typeLabel: '系统', name: '核心系统', url: 'https://example.com', parentId: 0,
                  children: [
                    {
                      id: 2, type: 2, typeLabel: '模块', name: '客户模块', parentId: 1,
                      children: [
                        { id: 3, type: 3, typeLabel: '功能', name: '查询客户', parentId: 2, children: [] },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        }),
        notes: [
          '统一信封：code=200 成功 / 4** 鉴权 / 5** 错误；业务数据在 data',
          '表内固定存在 id=0 根节点（type=0）；系统节点 parentId=0',
          '子节点只用 children[]，不再返回 modules/functions',
          '示例：GET /tree?name=客户&type=3&accounts=false',
        ],
      },
      {
        method: 'GET', path: '/api/v2/system-mgmt/meta',
        summary: '节点类型常量',
        respExample: J({
          typeMap: { '0': '根', '1': '系统', '2': '模块', '3': '功能' },
          types: [
            { type: 0, label: '根' },
            { type: 1, label: '系统' },
            { type: 2, label: '模块' },
            { type: 3, label: '功能' },
          ],
        }),
      },
      {
        method: 'GET', path: '/api/v2/system-mgmt/nodes',
        summary: '节点列表（可过滤）',
        desc: '可选 type / parentId；直接返回数组。',
        params: [
          { name: 'type', type: 'number', in: 'query', example: '1' },
          { name: 'parentId', type: 'number', in: 'query', example: '1' },
        ],
        respExample: J([{ id: 1, name: '核心系统', type: 1, parentId: 0 }]),
      },
      {
        method: 'GET', path: '/api/v2/system-mgmt/nodes/{id}',
        summary: '节点详情',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', desc: '节点 ID', example: '3' }],
        respExample: J({ id: 3, name: '查询客户', type: 3, parentId: 2 }),
      },
      {
        method: 'POST', path: '/api/v2/system-mgmt/nodes',
        summary: '新增节点',
        desc: 'type=1（系统）可同时传 accounts[] 一次创建多个系统账号；账号字段见参数说明。',
        params: [
          { name: 'type', type: 'number', required: true, in: 'body', desc: '1 系统 / 2 模块 / 3 功能' },
          { name: 'name', type: 'string', required: true, in: 'body', desc: '名称' },
          { name: 'parentId', type: 'number', in: 'body', desc: '父节点；系统节点固定为 0' },
          { name: 'url', type: 'string', in: 'body', desc: '系统地址（仅 type=1）', example: 'https://example.com' },
          { name: 'accounts', type: 'array', in: 'body', desc: '系统账号数组（仅 type=1）：[{ name, account, password, loginUrl?, remark?, sortOrder? }]' },
        ],
        reqExample: J({
          type: 1,
          parentId: 0,
          name: '核心系统',
          url: 'https://example.com',
          accounts: [{ name: '测试者', account: 701994, password: 1 }],
          description: '',
        }),
        respExample: J({
          id: 1,
          type: 1,
          name: '核心系统',
          url: 'https://example.com',
          parentId: 0,
          accounts: [{ id: 10, systemId: 1, name: '测试者', account: '701994', password: '1' }],
        }),
      },
      {
        method: 'PUT', path: '/api/v2/system-mgmt/nodes/{id}',
        summary: '修改节点',
        desc: 'type=1（系统）可传 accounts[] 全量替换该系统下的账号：按 id 更新、无 id 按 name 匹配，未出现的老账号删除；不传 accounts 则不动账号。',
        params: [
          { name: 'id', type: 'number', required: true, in: 'path', example: '1' },
          { name: 'accounts', type: 'array', in: 'body', desc: '系统账号数组（仅 type=1）：[{ id?, name, account, password, loginUrl?, remark?, sortOrder? }]' },
        ],
        reqExample: J({
          name: '系统节点-新名称',
          url: 'https://example.com/login',
          accounts: [{ name: '测试者', account: 701994, password: 1 }],
          description: '...',
        }),
        respExample: J({
          id: 1,
          name: '系统节点-新名称',
          url: 'https://example.com/login',
          accounts: [{ id: 10, systemId: 1, name: '测试者', account: '701994', password: '1' }],
        }),
      },
      {
        method: 'DELETE', path: '/api/v2/system-mgmt/nodes/{id}',
        summary: '删除节点（级联子节点）',
        desc: '成功返回 { code:200, data:null }。',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '3' }],
        respExample: J({ code: 200, message: 'ok', data: null }),
      },
      {
        method: 'GET', path: '/api/v2/system-mgmt/export',
        summary: '导出整树 Excel',
        desc: '返回 .xlsx 二进制（非 JSON 信封）。列：*父节点 / *类型 / *名称 / 地址（系统下填写） / 备注；父路径用 / 分隔。',
        tryable: false,
        notes: ['Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'filename=system-tree-export.xlsx'],
      },
      {
        method: 'GET', path: '/api/v2/system-mgmt/template',
        summary: '下载导入模板 Excel',
        desc: '返回带示例行的 .xlsx；A2 单元格备注「父节点路径按 / 分割」。',
        tryable: false,
        notes: ['filename=system-tree-template.xlsx'],
      },
      {
        method: 'POST', path: '/api/v2/system-mgmt/import',
        summary: '导入 Excel 树',
        desc: 'multipart/form-data，字段 file=.xlsx；可选 mode=merge|append（默认 merge，按父路径+名称+类型合并）。成功仍返回 JSON 信封。',
        tryable: false,
        reqExample: 'form-data: file=@system-tree.xlsx; mode=merge',
        respExample: J({ created: 1, updated: 0, skipped: 0, mode: 'merge', tree: [] }),
        notes: ['类型填：系统 / 模块 / 功能', '系统行父节点留空；模块父=系统名；功能父=系统名/模块名'],
      },
    ],
  },
];
