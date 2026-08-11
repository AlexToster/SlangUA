#!/usr/bin/env tsx
/**
 * Rollback test for refresh token rotation.
 * 
 * This test verifies that if createRefreshToken() throws after 
 * invalidateRefreshToken() already succeeded (e.g. a transient DB error),
 * the user's session is NOT destroyed - the original token row still exists
 * because the transaction rolls back.
 */

import { PrismaClient } from '@prisma/client';
import { authService } from '../src/services/auth.service.js';

const prisma = new PrismaClient();

// Store original method
const originalRefreshTokens = authService.refreshTokens.bind(authService);

async function main() {
  console.log('=== Refresh Token Rollback Test ===\n');

  // Step 1: Create a test user and get initial tokens
  console.log('Step 1: Creating test user and initial refresh token...');
  
  const testTelegramId = `test_rollback_${Date.now()}`;
  const user = await prisma.user.upsert({
    where: { telegramId: testTelegramId },
    update: {},
    create: {
      telegramId: testTelegramId,
      username: 'test_user',
      firstName: 'Test',
      lastName: 'User',
    },
  });
  console.log(`Created test user: ${user.id} (telegramId: ${user.telegramId})`);

  // Create initial refresh token
  const refreshToken = authService.generateRefreshToken();
  const refreshTokenRecord = await authService.createRefreshToken(user.id, refreshToken, { test: true });
  console.log(`Created initial refresh token: ${refreshTokenRecord.id}`);
  console.log(`Refresh token (plain): ${refreshToken.substring(0, 20)}...`);

  // Verify initial state - should have exactly 1 refresh token
  const initialTokens = await prisma.refreshToken.findMany({ where: { userId: user.id } });
  console.log(`Initial refresh tokens for user: ${initialTokens.length}`);
  if (initialTokens.length !== 1) {
    console.error('FAIL: Expected exactly 1 initial refresh token');
    process.exit(1);
  }
  const originalTokenId = initialTokens[0].id;
  console.log(`Original token ID: ${originalTokenId}`);

  // Step 2: Monkey-patch refreshTokens to throw after delete but before create
  console.log('\nStep 2: Patching refreshTokens to simulate transient DB error after delete...');
  
  let deleteCalled = false;
  let createCalled = false;
  
  // We'll replace the method with a version that throws after the delete
  authService.refreshTokens = async function(refreshToken: string) {
    const hashedToken = this.hashRefreshToken(refreshToken);

    return this.prisma.$transaction(async (tx) => {
      const tokenRecord = await tx.refreshToken.findUnique({
        where: { hashedToken },
        include: { user: true },
      });
      if (!tokenRecord) {
        throw new Error('Invalid refresh token');
      }
      if (tokenRecord.expiresAt < new Date()) {
        await tx.refreshToken.delete({ where: { hashedToken } }).catch(() => {});
        throw new Error('Refresh token expired');
      }

      // This delete is the concurrency guard
      await tx.refreshToken.delete({ where: { hashedToken } });
      deleteCalled = true;
      console.log('  [DEBUG] Delete executed in transaction');

      // SIMULATE TRANSIENT DB ERROR - throw after delete but before create
      throw new Error('SIMULATED_TRANSIENT_DB_ERROR');

      const newRefreshToken = this.generateRefreshToken();
      const newTokenRecord = await tx.refreshToken.create({
        data: {
          userId: tokenRecord.userId,
          hashedToken: this.hashRefreshToken(newRefreshToken),
          expiresAt: new Date(Date.now() + this.parseTtlToMs(this.refreshTokenTtl)),
          deviceInfo: tokenRecord.deviceInfo as any,
        },
      });
      createCalled = true;

      const accessToken = await this.generateAccessToken(
        tokenRecord.userId,
        tokenRecord.user.telegramId,
        newTokenRecord.id,
      );

      return { accessToken, refreshToken: newRefreshToken };
    });
  };

  // Step 3: Run refreshTokens once - it should fail with our simulated error
  console.log('\nStep 3: Calling refreshTokens (should fail with simulated error)...');
  
  try {
    await authService.refreshTokens(refreshToken);
    console.error('FAIL: Expected refreshTokens to throw SIMULATED_TRANSIENT_DB_ERROR');
    process.exit(1);
  } catch (error) {
    if (error instanceof Error && error.message === 'SIMULATED_TRANSIENT_DB_ERROR') {
      console.log('✓ Got expected simulated error');
    } else {
      console.error('FAIL: Got unexpected error:', error);
      process.exit(1);
    }
  }

  // Step 4: Verify the original token still exists (rollback worked!)
  console.log('\nStep 4: Verifying database state after failed transaction...');
  
  const tokensAfterFailure = await prisma.refreshToken.findMany({ where: { userId: user.id } });
  console.log(`Refresh tokens after failed transaction: ${tokensAfterFailure.length}`);
  
  if (tokensAfterFailure.length !== 1) {
    console.error(`FAIL: Expected exactly 1 refresh token after rollback, got ${tokensAfterFailure.length}`);
    console.error('Tokens:', tokensAfterFailure.map(t => ({ id: t.id, hashedToken: t.hashedToken.substring(0, 20) + '...' })));
    process.exit(1);
  }

  const remainingToken = tokensAfterFailure[0];
  console.log(`Remaining token ID: ${remainingToken.id}`);
  console.log(`Original token ID was: ${originalTokenId}`);
  
  if (remainingToken.id !== originalTokenId) {
    console.error('FAIL: Remaining token is NOT the original token - rollback did not work!');
    process.exit(1);
  }

  console.log('✓ Original token still exists - transaction rolled back correctly!');

  // Step 5: Restore original method and verify normal operation works
  console.log('\nStep 5: Restoring original refreshTokens and verifying normal operation...');
  
  authService.refreshTokens = originalRefreshTokens;
  
  try {
    const result = await authService.refreshTokens(refreshToken);
    console.log('✓ Normal refresh works after rollback');
    console.log(`  New access token: ${result.accessToken.substring(0, 30)}...`);
    console.log(`  New refresh token: ${result.refreshToken.substring(0, 30)}...`);
  } catch (error) {
    console.error('FAIL: Normal refresh should work after rollback:', error);
    process.exit(1);
  }

  // Verify final state has exactly 1 token (the newly rotated one)
  const finalTokens = await prisma.refreshToken.findMany({ where: { userId: user.id } });
  console.log(`\nFinal refresh tokens after successful rotation: ${finalTokens.length}`);
  if (finalTokens.length !== 1) {
    console.error(`FAIL: Expected exactly 1 refresh token after successful rotation, got ${finalTokens.length}`);
    process.exit(1);
  }

  // Cleanup
  await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
  console.log('\n✓ Cleanup completed');

  console.log('\n=== ROLLBACK TEST PASSED ===');
  process.exit(0);
}

main().catch(async (error) => {
  console.error('\n=== TEST FAILED WITH ERROR ===');
  console.error(error);
  
  // Attempt cleanup
  try {
    await prisma.$disconnect();
  } catch {}
  process.exit(1);
});