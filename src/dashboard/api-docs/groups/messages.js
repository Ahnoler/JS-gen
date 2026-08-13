import { J } from './_j.js';

/** @type {TagGroup[]} */
export const GROUP_MESSAGES = [
  {
    id: 'messages',
    name: '消息',
    description: '产品通知抽屉。第一种类型：批量导入任务终态一条。用户字段挂起，全员同一份列表/已读。',
    endpoints: [
      {
        method: 'GET', path: '/api/v2/messages',
        summary: '消息列表（新→旧）',
        params: [
          { name: 'pageNum', type: 'number', in: 'query', example: '1' },
          { name: 'pageSize', type: 'number', in: 'query', example: '20' },
        ],
        respExample: J({
          code: 200,
          message: 'ok',
          data: {
            rows: [{
              msgId: 1,
              msgTitle: '批量导入任务',
              workItemName: '批量导入任务',
              msgContent: '对公客户管理 · 客户导入.xlsx · 已完成<br>共 3 条 · 受理 3 · 拒绝 0 · 已存草稿 0 · 已录制 3 · 失败 0',
              msgType: 1,
              msgTypeLabel: '批量导入任务',
              msgStatus: 0,
              createTime: '2026-08-13 16:00:00',
              createBy: '系统',
              belongItemName: '对公客户管理',
              linkUrl: '/ui-recording?batchId=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
            }],
            total: 1,
          },
        }),
        notes: [
          'pageNum 从 1；默认 pageSize=20，最大 100',
          'msgStatus 0 未读 / 2 已读（现阶段全局）',
          'msgType 见字典 sys_msg_type；第一种 dict_value=1 批量导入任务',
          '终态才插入；不补历史任务',
        ],
      },
      {
        method: 'GET', path: '/api/v2/messages/unread-count',
        summary: '未读数量',
        respExample: J({ code: 200, message: 'ok', data: { count: 3 } }),
      },
      {
        method: 'POST', path: '/api/v2/messages/{id}/read',
        summary: '单条已读',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '1' }],
        respExample: J({ code: 200, message: 'ok', data: { success: true } }),
        notes: ['已读再点仍 200；不存在 HTTP 404'],
      },
      {
        method: 'POST', path: '/api/v2/messages/read-all',
        summary: '全部已读',
        respExample: J({ code: 200, message: 'ok', data: { success: true } }),
      },
    ],
  },
];
