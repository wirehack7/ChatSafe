'use strict';

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverageFrom: ['server.js'],
  coverageThreshold: {
    global: {
      lines: 60,
    },
  },
};
