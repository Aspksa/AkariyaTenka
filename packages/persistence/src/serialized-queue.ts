export class SerializedQueue {
  private tail = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  async idle(): Promise<void> { await this.tail; }
}
