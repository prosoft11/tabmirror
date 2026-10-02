import {
  DynamoDBDocumentClient,
  GetCommand,
  TransactWriteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { ApiError } from '../private-store.js';
export interface Row {
  pk: string;
  sk: string;
  version: number;
  [key: string]: any;
}
export interface Change {
  before?: Row;
  after?: Row;
  pk: string;
  sk: string;
}
export interface Backend {
  get(pk: string, sk: string): Promise<Row | undefined>;
  commit(changes: Change[]): Promise<boolean>;
  query(pk: string, prefix: string): Promise<Row[]>;
}
/** Reads are validated again at commit, including read-only authorization checks. */
export class Transaction {
  private changes = new Map<string, Change>();
  private guards: (() => void)[] = [];
  beforeCommit(guard: () => void) {
    this.guards.push(guard);
  }
  constructor(private backend: Backend) {}
  async get(pk: string, sk = 'META'): Promise<Row | undefined> {
    const key = JSON.stringify([pk, sk]);
    let change = this.changes.get(key);
    if (!change) {
      const before = await this.backend.get(pk, sk);
      change = { pk, sk, before };
      this.changes.set(key, change);
    }
    return Object.hasOwn(change, 'after') ? change.after : change.before;
  }
  async put(pk: string, value: Record<string, any>, sk = 'META') {
    await this.get(pk, sk);
    const change = this.changes.get(JSON.stringify([pk, sk]))!;
    change.after = {
      ...value,
      pk,
      sk,
      version: (change.before?.version ?? 0) + 1,
    };
  }
  async delete(pk: string, sk = 'META') {
    await this.get(pk, sk);
    this.changes.get(JSON.stringify([pk, sk]))!.after = undefined;
  }
  commit() {
    for (const guard of this.guards) guard();
    return this.backend.commit([...this.changes.values()]);
  }
}
export async function transact<T>(
  backend: Backend,
  work: (tx: Transaction) => Promise<T>,
): Promise<Exclude<T, ApiError>> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const tx = new Transaction(backend);
    const result = await work(tx);
    if (await tx.commit()) {
      if (result instanceof ApiError) throw result;
      return result as Exclude<T, ApiError>;
    }
    await new Promise((resolve) =>
      setTimeout(resolve, 5 + Math.random() * 20 * (attempt + 1)),
    );
  }
  throw new ApiError(503, 'STORAGE_BUSY', 'Please retry shortly.');
}
export class DynamoBackend implements Backend {
  constructor(
    private client: DynamoDBDocumentClient,
    private table: string,
  ) {}
  async get(pk: string, sk: string) {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.table,
        Key: { pk, sk },
        ConsistentRead: true,
      }),
    );
    return result.Item as Row | undefined;
  }
  async commit(changes: Change[]) {
    if (!changes.length) return true;
    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: changes.map((change) => {
            const condition = change.before
              ? {
                  ConditionExpression: '#v = :v',
                  ExpressionAttributeNames: { '#v': 'version' },
                  ExpressionAttributeValues: { ':v': change.before.version },
                }
              : { ConditionExpression: 'attribute_not_exists(pk)' };
            const common = { TableName: this.table, ...condition };
            if (!Object.hasOwn(change, 'after'))
              return {
                ConditionCheck: {
                  ...common,
                  Key: { pk: change.pk, sk: change.sk },
                },
              };
            if (change.after) return { Put: { ...common, Item: change.after } };
            return {
              Delete: { ...common, Key: { pk: change.pk, sk: change.sk } },
            };
          }),
        }),
      );
      return true;
    } catch (error) {
      const e = error as {
        name?: string;
        CancellationReasons?: { Code?: string }[];
      };
      if (
        e.name === 'TransactionCanceledException' &&
        e.CancellationReasons?.some((r) =>
          ['ConditionalCheckFailed', 'TransactionConflict'].includes(
            r.Code ?? '',
          ),
        ) &&
        e.CancellationReasons.every((r) =>
          ['None', 'ConditionalCheckFailed', 'TransactionConflict'].includes(
            r.Code ?? 'None',
          ),
        )
      )
        return false;
      if (e.name === 'TransactionConflictException') return false;
      throw error;
    }
  }
  async query(pk: string, prefix: string) {
    const rows: Row[] = [];
    let cursor: Record<string, any> | undefined;
    do {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.table,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
          ExpressionAttributeValues: { ':pk': pk, ':prefix': prefix },
          ConsistentRead: true,
          ExclusiveStartKey: cursor,
        }),
      );
      rows.push(...((result.Items ?? []) as Row[]));
      cursor = result.LastEvaluatedKey;
    } while (cursor);
    return rows;
  }
}
