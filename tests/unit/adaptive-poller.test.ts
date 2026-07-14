import { AdaptivePoller, jitterDelayMs, nextIdleDelayMs } from '../../src/utils/adaptive-poller';

afterEach(() => {
  jest.useRealTimers();
});

test('idle delay grows exponentially and remains capped', () => {
  expect(nextIdleDelayMs(1, 15_000, 60_000)).toBe(15_000);
  expect(nextIdleDelayMs(2, 15_000, 60_000)).toBe(30_000);
  expect(nextIdleDelayMs(3, 15_000, 60_000)).toBe(60_000);
  expect(nextIdleDelayMs(10, 15_000, 60_000)).toBe(60_000);
});

test('jitter is bounded around the selected delay', () => {
  expect(jitterDelayMs(10_000, 0.15, 0)).toBe(8500);
  expect(jitterDelayMs(10_000, 0.15, 0.5)).toBe(10_000);
  expect(jitterDelayMs(10_000, 0.15, 1)).toBe(11_500);
});

test('scheduled work never overlaps and returns to active cadence after work', async () => {
  jest.useFakeTimers();
  let release: (() => void) | undefined;
  const task = jest.fn(() => new Promise<number>((resolve) => {
    release = () => resolve(1);
  }));
  const poller = new AdaptivePoller({ task, initialDelayMs: 10, activeDelayMs: 20, random: () => 0.5 });

  poller.start();
  jest.advanceTimersByTime(10);
  await Promise.resolve();
  expect(task).toHaveBeenCalledTimes(1);

  poller.wake();
  jest.advanceTimersByTime(100);
  expect(task).toHaveBeenCalledTimes(1);

  release?.();
  await Promise.resolve();
  await Promise.resolve();
  jest.advanceTimersByTime(19);
  expect(task).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(1);
  expect(task).toHaveBeenCalledTimes(2);
  poller.stop();
});
