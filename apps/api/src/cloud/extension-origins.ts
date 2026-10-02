/** Accept only explicitly configured Chrome identities, including migration builds. */
export function extensionOrigins(value: string): RegExp {
  const ids = value.split(',');
  if (!ids.length || ids.some((id) => id.length !== 32 || !/^[a-p]+$/.test(id)))
    throw Error('Valid production extension identities required');
  return new RegExp(`^chrome-extension://(?:${[...new Set(ids)].join('|')})$`);
}
