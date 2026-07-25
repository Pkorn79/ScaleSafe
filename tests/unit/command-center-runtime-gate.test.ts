import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(path.join(process.cwd(), 'src', 'index.ts'), 'utf8');

test('durable schedules replace legacy timers only behind the Phase 2 flag', () => {
  expect(source).toContain('if (config.operator.healthEnabled)');
  expect(source).toContain('commandCenterRuntime.start()');
  expect(source).toContain('if (!config.operator.healthEnabled)');
  expect(source).toContain('runProvisioningRecovery()');
  expect(source).toContain('runPaymentReminderCheck()');
  expect(source).toContain('runPulseCadenceCheck()');
});

