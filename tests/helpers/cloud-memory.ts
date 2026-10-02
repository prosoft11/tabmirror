import type {
  Backend,
  Change,
  Row,
} from '../../apps/api/src/cloud/transactions';
import type { Objects } from '../../apps/api/src/cloud/objects';
export class MemoryBackend implements Backend {
  rows = new Map<string, Row>();
  async get(pk: string, sk: string) {
    return structuredClone(this.rows.get(JSON.stringify([pk, sk])));
  }
  async query(pk: string, prefix: string) {
    return structuredClone(
      [...this.rows.values()]
        .filter((row) => row.pk === pk && row.sk.startsWith(prefix))
        .sort((a, b) => a.sk.localeCompare(b.sk)),
    );
  }
  async commit(changes: Change[]) {
    if (
      changes.some(
        (c) =>
          this.rows.get(JSON.stringify([c.pk, c.sk]))?.version !==
          c.before?.version,
      )
    )
      return false;
    for (const c of changes)
      if (Object.hasOwn(c, 'after')) {
        const key = JSON.stringify([c.pk, c.sk]);
        if (c.after) this.rows.set(key, structuredClone(c.after));
        else this.rows.delete(key);
      }
    return true;
  }
}
export class MemoryObjects implements Objects {
  values = new Map<string, string>();
  afterPut?: () => Promise<void>;
  afterGet?: () => Promise<void>;
  async put(key: string, value: string) {
    this.values.set(key, value);
    await this.afterPut?.();
  }
  async get(key: string) {
    const value = this.values.get(key);
    if (value === undefined) throw Error('Missing object');
    await this.afterGet?.();
    return value;
  }
  async delete(key: string) {
    this.values.delete(key);
  }
}
