// Run a task over a list with a bounded number in flight. Imports are mostly
// waiting on camptocamp, so a handful at a time is dramatically faster than one
// after another — but "all at once" would hammer them and blow the memory
// budget of a serverless function re-encoding photos.
export async function runPool<T>(
  items: T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<void>
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      await task(items[index], index);
    }
  });
  await Promise.all(workers);
}
