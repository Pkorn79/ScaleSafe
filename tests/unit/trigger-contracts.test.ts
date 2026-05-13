import { VALID_TRIGGER_KEYS } from '../../src/constants/trigger-keys';
import { FIELD_AUTOMATION_CONTRACTS, getTriggerContracts, TRIGGER_CONTRACTS } from '../../src/constants/trigger-contracts';

describe('trigger contracts', () => {
  test('defines a contract for every valid Marketplace trigger key', () => {
    const contracts = getTriggerContracts();

    expect(contracts).toHaveLength(VALID_TRIGGER_KEYS.length);
    for (const key of VALID_TRIGGER_KEYS) {
      expect(TRIGGER_CONTRACTS[key]).toEqual(expect.objectContaining({
        key,
        label: expect.any(String),
        owner: expect.any(String),
        firesFrom: expect.any(String),
        requiredPayloadFields: expect.any(Array),
      }));
    }
  });

  test('tracks engagement field-change automations separately from Marketplace triggers', () => {
    expect(FIELD_AUTOMATION_CONTRACTS).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'Client At Risk',
        fieldKey: 'contact.ss_engagement_status',
        expectedValue: 'At Risk',
      }),
      expect.objectContaining({
        label: 'Client Re-Engaged',
        fieldKey: 'contact.ss_engagement_status',
        expectedValue: 'Active',
      }),
    ]));
  });
});
