/**
 * Canonicalize recorded action names for persist / replay / assemble.
 * Maps CTRL camelCase, LLM kinds, and historical aliases → snake_case.
 */

const ALIASES = Object.freeze({
  treeSelect: 'select_tree_option',
  selectTreeOption: 'select_tree_option',
  tree_select: 'select_tree_option',
  treeselect: 'select_tree_option',
  fill_tree: 'select_tree_option',
  fillTree: 'select_tree_option',
  fillFormField: 'fill_form_field',
  fill_date_field: 'fill_form_field',
  fillDateField: 'fill_form_field',
  selectOption: 'select_option',
  clickRadio: 'click_radio',
  clickMenuItem: 'click_menu_item',
  clickTableRowButton: 'click_table_row_button',
  clickTableRowRadio: 'click_table_row_radio',
  clickAdjacentButton: 'click_adjacent_button',
  closeDialog: 'close_dialog',
  waitForLoading: 'wait_for_loading',
  goToUrl: 'go_to_url',
  clickElementByIndex: 'click_element_by_index',
});

const CANONICAL = new Set([
  'fill_form_field',
  'select_option',
  'select_tree_option',
  'click_radio',
  'click_menu_item',
  'click_table_row_button',
  'click_table_row_radio',
  'click_adjacent_button',
  'click_element_by_index',
  'close_dialog',
  'wait_for_loading',
  'go_to_url',
  'login',
  'switch_tab',
]);

/**
 * @param {string} actionName
 * @returns {string}
 */
export function normalizeActionName(actionName) {
  const raw = String(actionName || '').trim();
  if (!raw) return '';
  if (ALIASES[raw]) return ALIASES[raw];
  const snake = raw.replace(/-/g, '_');
  if (ALIASES[snake]) return ALIASES[snake];
  const lower = snake.toLowerCase();
  if (ALIASES[lower]) return ALIASES[lower];
  const camelToSnake = raw
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/-/g, '_')
    .toLowerCase();
  if (CANONICAL.has(camelToSnake)) return camelToSnake;
  if (ALIASES[camelToSnake]) return ALIASES[camelToSnake];
  return raw;
}
