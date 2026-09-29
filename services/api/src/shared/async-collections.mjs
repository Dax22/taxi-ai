/**
 * Async collection operations deliberately run in order. Service callbacks may
 * write through a shared transaction connection, and predicate operations must
 * retain the short-circuit behavior of their synchronous counterparts.
 */
export async function asyncMap(items, project) {
  const result = [];
  for (let index = 0; index < items.length; index += 1) result.push(await project(items[index], index, items));
  return result;
}
export async function asyncFlatMap(items, project) { return (await asyncMap(items, project)).flat(); }
export async function asyncFilter(items, predicate) {
  const result = [];
  for (let index = 0; index < items.length; index += 1) if (await predicate(items[index], index, items)) result.push(items[index]);
  return result;
}
export async function asyncSome(items, predicate) {
  for (let index = 0; index < items.length; index += 1) if (await predicate(items[index], index, items)) return true;
  return false;
}
export async function asyncEvery(items, predicate) {
  for (let index = 0; index < items.length; index += 1) if (!await predicate(items[index], index, items)) return false;
  return true;
}
export async function asyncFind(items, predicate) {
  for (let index = 0; index < items.length; index += 1) if (await predicate(items[index], index, items)) return items[index];
  return undefined;
}
export async function asyncForEach(items, visit) {
  for (let index = 0; index < items.length; index += 1) await visit(items[index], index, items);
}
