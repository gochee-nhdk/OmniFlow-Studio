import test from 'node:test';
import assert from 'node:assert/strict';
import { FMDatabase } from '../dist/index.js';

test.describe('Package @fm/database - Security Redaction Tests', () => {
  test('logError: sanitizes sensitive passwords in message and technical details', () => {
    const db = new FMDatabase(':memory:');
    try {
      db.logError({
        errorType: 'AUTH_FAILURE',
        severity: 'CRITICAL',
        message: 'SAP login failure with password="SecretPassword123!" at gateway',
        technicalDetails: 'Stack: at connect (sbo_password=SuperSecret999#) line 123',
      });

      const errors = db.listErrors(10);
      assert.equal(errors.length, 1);
      const row = errors[0];

      assert.ok(!row.message.includes('SecretPassword123!'));
      assert.ok(row.message.includes('[REDACTED]'));

      assert.ok(row.technicalDetails);
      assert.ok(!row.technicalDetails.includes('SuperSecret999#'));
      assert.ok(row.technicalDetails.includes('[REDACTED]'));
    } finally {
      db.close();
    }
  });

  test('audit: sanitizes sensitive passwords and tokens in audit details and target', () => {
    const db = new FMDatabase(':memory:');
    try {
      db.audit('credentials:save', 'POS_MAIN:password=SecretPassword123!', {
        secret: 'SuperSecretKey!@#',
        authHeader: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig',
      });

      // Query audit_logs directly
      const rows = db.db.prepare('SELECT * FROM audit_logs').all();
      assert.equal(rows.length, 1);
      const row = rows[0];

      assert.ok(!row.target.includes('SecretPassword123!'));
      assert.ok(row.target.includes('[REDACTED]'));

      assert.ok(!row.details.includes('SuperSecretKey!@#'));
      assert.ok(!row.details.includes('eyJhbGciOiJIUzI1NiJ9'));
      assert.ok(row.details.includes('Bearer [REDACTED]'));
    } finally {
      db.close();
    }
  });
});
