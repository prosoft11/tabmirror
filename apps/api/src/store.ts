import type { SnapshotEnvelope } from '@tabmirror/contracts';
export interface SnapshotStore {
  get(ownerId: string, deviceId: string): Promise<SnapshotEnvelope | null>;
  replace(ownerId: string, value: SnapshotEnvelope): Promise<void>;
}
/** Synthetic data only. A new process starts with a clean store. */
export class MemorySnapshotStore implements SnapshotStore {
  private owners = new Map<string, Map<string, SnapshotEnvelope>>();
  async get(ownerId: string, deviceId: string) {
    return structuredClone(this.owners.get(ownerId)?.get(deviceId) ?? null);
  }
  async replace(ownerId: string, value: SnapshotEnvelope) {
    const devices =
      this.owners.get(ownerId) ?? new Map<string, SnapshotEnvelope>();
    devices.set(value.device.id, structuredClone(value));
    this.owners.set(ownerId, devices);
  }
}
