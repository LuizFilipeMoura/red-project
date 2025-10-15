module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/apps/socket/src/__tests__'],
  moduleNameMapper: {
    '^@repo/shared$': '<rootDir>/packages/shared/src/index.ts',
    '^@repo/shared/(.*)$': '<rootDir>/packages/shared/src/$1',
    '^@repo/db$': '<rootDir>/packages/db/src/index.ts',
    '^@repo/db/(.*)$': '<rootDir>/packages/db/src/$1',
  },
};
