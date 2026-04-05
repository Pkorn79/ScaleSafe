module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/tests/setup-env.ts'],
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: ['src/**/*.ts', '!src/index.ts', '!src/types/**'],
};
