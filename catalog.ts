// Perch 2.4.138's argument-validation output includes public names but
// excludes models gated on the account catalog and contains no ACP pin IDs.
export function catalogFromUsageError(output: string): string[] | undefined {
  const list = /^Unknown model: __bb_catalog_probe__\. [^\r\n]* named model \(([^)\r\n]+)\)\./m.exec(output)?.[1];
  if (!list) return undefined;
  const models = list.split(", ");
  if (models.length > 1_000 || models.some((id) => !/^[a-z0-9][a-z0-9.-]{0,127}$/.test(id))) return undefined;
  return [...new Set(models)];
}
