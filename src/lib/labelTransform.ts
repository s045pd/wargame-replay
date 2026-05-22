/**
 * Strip a filter substring from a unit name for the quick-filter display mode.
 *
 * Steps (matches user spec for the quick-filter feature):
 *   1. lowercase the name
 *   2. remove every occurrence of lowercase(filter)
 *   3. remove all `-` and `_` characters
 *   4. trim leading/trailing whitespace
 *
 * Examples:
 *   transformFilteredName('KFN-千叶', 'kfn')  // → '千叶'
 *   transformFilteredName('kfn_星辰', 'kfn')  // → '星辰'
 *   transformFilteredName('0791-红领巾', '0791') // → '红领巾'
 *
 * If `filter` is empty the original name is returned unchanged.
 */
export function transformFilteredName(name: string, filter: string): string {
  if (!filter) return name;
  const lcFilter = filter.toLowerCase();
  let out = name.toLowerCase().split(lcFilter).join('');
  out = out.replace(/[-_]/g, '');
  return out.trim();
}
