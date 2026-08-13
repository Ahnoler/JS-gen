/**
 * API group(s): hierarchy, sys-dict — extracted from catalog.js.
 * Keep in sync with src/routes/v2/*.js
 */
import { J } from './_j.js';

/** @type {TagGroup[]} */
export const GROUP_HIERARCHY = [
  {
    id: 'hierarchy',
    name: '层级 / 账号',
    description: '系统、模块、功能、系统账号的 REST CRUD（与系统管理互补）',
    endpoints: [
      {
        method: 'GET', path: '/api/v2/hierarchy/tree',
        summary: '层级树（children[]，同 system-mgmt/tree）',
        respExample: J([
          {
            id: 1, type: 1, name: '核心系统', url: 'https://example.com',
            children: [{ id: 2, type: 2, name: '客户模块', children: [] }],
          },
        ]),
      },
      {
        method: 'GET', path: '/api/v2/systems',
        summary: '系统列表',
        respExample: J([{ id: 1, name: '核心系统', uid: 'sys-1' }]),
      },
      {
        method: 'POST', path: '/api/v2/systems',
        summary: '创建系统',
        reqExample: J({ name: '核心系统', uid: 'sys-1', description: '', url: 'https://example.com' }),
        respExample: J({ id: 1, name: '核心系统', url: 'https://example.com' }),
      },
      {
        method: 'GET', path: '/api/v2/systems/{id}',
        summary: '系统详情',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '1' }],
      },
      {
        method: 'PUT', path: '/api/v2/systems/{id}',
        summary: '更新系统',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '1' }],
        reqExample: J({ name: '新名称', url: 'https://example.com' }),
      },
      {
        method: 'DELETE', path: '/api/v2/systems/{id}',
        summary: '删除系统',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '1' }],
      },
      {
        method: 'GET', path: '/api/v2/systems/{systemId}/accounts',
        summary: '系统下账号列表',
        params: [{ name: 'systemId', type: 'number', required: true, in: 'path', example: '1' }],
        respExample: J([{ id: 10, systemId: 1, name: '测试员', loginUrl: 'https://...', username: 'u' }]),
      },
      {
        method: 'POST', path: '/api/v2/systems/{systemId}/accounts',
        summary: '创建系统账号',
        params: [{ name: 'systemId', type: 'number', required: true, in: 'path', example: '1' }],
        reqExample: J({ name: '测试员', loginUrl: 'https://example.com/login', username: 'u', password: 'p' }),
        respExample: J({ id: 10, systemId: 1, name: '测试员', loginUrl: 'https://...', username: 'u', password: 'p' }),
      },
      {
        method: 'GET', path: '/api/v2/system-accounts/{id}',
        summary: '账号详情',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '10' }],
      },
      {
        method: 'PUT', path: '/api/v2/system-accounts/{id}',
        summary: '更新账号',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '10' }],
        reqExample: J({ name: '测试员', loginUrl: 'https://...', username: 'u', password: 'p' }),
      },
      {
        method: 'DELETE', path: '/api/v2/system-accounts/{id}',
        summary: '删除账号',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '10' }],
      },
      {
        method: 'GET', path: '/api/v2/systems/{systemId}/processes',
        summary: '模块列表',
        params: [{ name: 'systemId', type: 'number', required: true, in: 'path', example: '1' }],
      },
      {
        method: 'POST', path: '/api/v2/systems/{systemId}/processes',
        summary: '创建模块',
        params: [{ name: 'systemId', type: 'number', required: true, in: 'path', example: '1' }],
        reqExample: J({ name: '客户模块', sortOrder: 0 }),
      },
      {
        method: 'PUT', path: '/api/v2/processes/{id}',
        summary: '更新模块',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '2' }],
        reqExample: J({ name: '客户模块' }),
      },
      {
        method: 'DELETE', path: '/api/v2/processes/{id}',
        summary: '删除模块',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '2' }],
      },
      {
        method: 'GET', path: '/api/v2/processes/{processId}/functions',
        summary: '功能列表',
        params: [{ name: 'processId', type: 'number', required: true, in: 'path', example: '2' }],
      },
      {
        method: 'POST', path: '/api/v2/processes/{processId}/functions',
        summary: '创建功能',
        params: [{ name: 'processId', type: 'number', required: true, in: 'path', example: '2' }],
        reqExample: J({ name: '查询客户' }),
      },
      {
        method: 'PUT', path: '/api/v2/functions/{id}',
        summary: '更新功能',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '3' }],
        reqExample: J({ name: '查询客户' }),
      },
      {
        method: 'DELETE', path: '/api/v2/functions/{id}',
        summary: '删除功能',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '3' }],
      },
    ],
  },
  {
    id: 'sys-dict',
    name: '字典管理',
    description: '通用字典类型与数据（sys_dict_type / sys_dict_data）；特殊元素分类用 dict_type=special_element_tag；消息类型 dict_type=sys_msg_type（1=批量导入任务）',
    endpoints: [
      {
        method: 'GET', path: '/api/v2/system/dict/type',
        summary: '字典类型列表',
        params: [{ name: 'status', type: 'string', in: 'query', desc: '0 正常 / 1 停用', example: '0' }],
        respExample: J([{ dictId: 1, dictName: '特殊元素标签', dictType: 'special_element_tag', status: '0' }]),
      },
      {
        method: 'GET', path: '/api/v2/system/dict/type/{dictId}',
        summary: '字典类型详情',
        params: [{ name: 'dictId', type: 'number', required: true, in: 'path', example: '1' }],
      },
      {
        method: 'POST', path: '/api/v2/system/dict/type',
        summary: '新增字典类型',
        reqExample: J({ dictName: '特殊元素标签', dictType: 'special_element_tag', remark: '' }),
      },
      {
        method: 'PUT', path: '/api/v2/system/dict/type/{dictId}',
        summary: '更新字典类型',
        params: [{ name: 'dictId', type: 'number', required: true, in: 'path', example: '1' }],
        reqExample: J({ dictName: '特殊元素标签', status: '0' }),
      },
      {
        method: 'DELETE', path: '/api/v2/system/dict/type/{dictId}',
        summary: '删除字典类型（下有数据则拒绝）',
        params: [{ name: 'dictId', type: 'number', required: true, in: 'path', example: '1' }],
      },
      {
        method: 'GET', path: '/api/v2/system/dict/data',
        summary: '字典数据列表',
        params: [
          { name: 'dictType', type: 'string', in: 'query', example: 'special_element_tag' },
          { name: 'status', type: 'string', in: 'query', example: '0' },
        ],
      },
      {
        method: 'GET', path: '/api/v2/system/dict/data/type/{dictType}',
        summary: '某类型下正常状态条目（入库弹窗下拉）',
        params: [{ name: 'dictType', type: 'string', required: true, in: 'path', example: 'special_element_tag' }],
        respExample: J([
          { dictCode: 1, dictLabel: '登录', dictValue: 'login', dictType: 'special_element_tag', status: '0' },
          { dictCode: 2, dictLabel: '填写', dictValue: 'fill', dictType: 'special_element_tag', status: '0' },
        ]),
      },
      {
        method: 'GET', path: '/api/v2/system/dict/data/{dictCode}',
        summary: '字典数据详情',
        params: [{ name: 'dictCode', type: 'number', required: true, in: 'path', example: '1' }],
      },
      {
        method: 'POST', path: '/api/v2/system/dict/data',
        summary: '新增字典数据',
        reqExample: J({
          dictType: 'special_element_tag',
          dictLabel: '登录',
          dictValue: 'login',
          dictSort: 1,
        }),
      },
      {
        method: 'PUT', path: '/api/v2/system/dict/data/{dictCode}',
        summary: '更新字典数据',
        params: [{ name: 'dictCode', type: 'number', required: true, in: 'path', example: '1' }],
        reqExample: J({ dictLabel: '登录', status: '0' }),
      },
      {
        method: 'DELETE', path: '/api/v2/system/dict/data/{dictCode}',
        summary: '删除字典数据（被 special_element 引用则拒绝）',
        params: [{ name: 'dictCode', type: 'number', required: true, in: 'path', example: '1' }],
      },
    ],
  },
];
