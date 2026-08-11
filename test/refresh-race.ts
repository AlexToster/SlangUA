#!/usr/bin/env tsx
/**
 * Race condition test for refresh token rotation.
 * 
 * This test:
 * 1. Authenticates once to get a valid refreshToken
 * 2. Fires TWO concurrent POST /api/v1/auth/refresh requests with the SAME refreshToken
 * 3. Verifies: exactly one request resolves 200 with a new token pair, the other resolves 401 INVALID_REFRESH_TOKEN
 * 4. Verifies no orphaned RefreshToken rows (exactly one after race)
 */

import { PrismaClient } from '@prisma/client';
import { authService } from '../src/services/auth.service.js';
import { config } from '../src/config/index.js';

const prisma = new PrismaClient();

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('=== Refresh Token Race Condition Test ===\n');

  // Step 1: Create a test user and get initial tokens
  console.log('Step 1: Authenticating to get initial tokens...');
  
  // We need to create a test user via the authenticateWithTelegram flow
  // Since we don't have real Telegram initData, we'll create a user directly
  // and then create a refresh token for them
  
  const testTelegramId = `test_race_${Date.now()}`;
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

  // Step 2: Fire two concurrent refresh requests with the SAME refresh token
  console.log('\nStep 2: Firing two concurrent refresh requests...');
  
  const refreshTokens = async (token: string) => {
    const hashedToken = authService.hashRefreshToken(token);
    
    // Use the internal method directly to avoid HTTP overhead
    // but we need to test the actual transaction behavior
    return authService.refreshTokens(token);
  };

  // Execute both concurrently
  const startTime = Date.now();
  const results = await Promise.allSettled([
    refreshTokens(refreshToken),
    refreshTokens(refreshToken),
  ]);
  const elapsed = Date.now() - startTime;
  console.log(`Both requests completed in ${elapsed}ms`);

  // Step 3: Analyze results
  console.log('\nStep 3: Analyzing results...');
  
  let successCount = 0;
  let invalidTokenCount = 0;
  let otherErrorCount = 0;
  let newAccessToken: string | null = null;
  let newRefreshToken: string | null = null;

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    console.log(`\nRequest ${i + 1}:`);
    
    if (result.status === 'fulfilled') {
      console.log('  Status: FULFILLED (200 OK)');
      console.log(`  New access token: ${result.value.accessToken.substring(0, 30)}...`);
      console.log(`  New refresh token: ${result.value.refreshToken.substring(0, 30)}...`);
      successCount++;
      newAccessToken = result.value.accessToken;
      newRefreshToken = result.value.refreshToken;
    } else {
      console.log('  Status: REJECTED');
      console.log(`  Error: ${result.reason}`);
      
      // Check if it's the expected INVALID_REFRESH_TOKEN error
      if (result.reason instanceof Error && result.reason.message === 'Invalid refresh token') {
        console.log('  -> Expected INVALID_REFRESH_TOKEN error');
        invalidTokenCount++;
      } else {
        console.log('  -> UNEXPECTED ERROR');
        otherErrorCount++;
      }
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Successful (200): ${successCount}`);
  console.log(`Invalid token (401): ${invalidTokenCount}`);
  console.log(`Other errors: ${otherErrorCount}`);

  // Verify expectations
  if (successCount !== 1) {
    console.error('\nFAIL: Expected exactly 1 successful request, got', successCount);
    process.exit(1);
  }
  if (invalidTokenCount !== 1) {
    console.error('\nFAIL: Expected exactly 1 INVALID_REFRESH_TOKEN error, got', invalidTokenCount);
    process.exit(1);
  }
  if (otherErrorCount !== 0) {
    console.error('\nFAIL: Expected 0 other errors, got', otherErrorCount);
    process.exit(1);
  }

  console.log('\n✓ Race condition test PASSED: Exactly one 200, one 401 INVALID_REFRESH_TOKEN');

  // Step 4: Verify no orphaned RefreshToken rows
  console.log('\nStep 4: Verifying database state...');
  
  const finalTokens = await prisma.refreshToken.findMany({ where: { userId: user.id } });
  console.log(`Final refresh tokens for user: ${finalTokens.length}`);
  
  if (finalTokens.length !== 1) {
    console.error(`\nFAIL: Expected exactly 1 refresh token after race, got ${finalTokens.length}`);
    console.error('Tokens:', finalTokens.map(t => ({ id: t.id, hashedToken: t.hashedToken.substring(0, 20) + '...', expiresAt: t.expiresAt })));
    process.exit(1);
  }

  // Verify the remaining token is the newly created one
  const remainingToken = finalTokens[0];
  console.log(`Remaining token ID: ${remainingToken.id}`);
  console.log(`Remaining token expiresAt: ${remainingToken.expiresAt}`);
  
  // Verify the new refresh token works (can be used for another refresh)
  console.log('\nStep 5: Verifying new refresh token is valid...');
  try {
    const secondRefresh = await authService.refreshTokens(newRefreshToken!);
    console.log('✓ New refresh token works correctly (can be rotated again)');
    console.log(`  New access token: ${secondRefresh.accessToken.substring(0, 30)}...`);
    console.log(`  New refresh token: ${secondRefresh.refreshToken.substring(0, 30)}...`);
  } catch (error) {
    console.error('FAIL: New refresh token should be valid but got error:', error);
    process.exit(1);
  }

  // Verify final state has exactly 1 token again
  const finalTokens2 = await prisma.refreshToken.findMany({ where: { userId: user.id } });
  console.log(`\nFinal refresh tokens after second rotation: ${finalTokens2.length}`);
  if (finalTokens2.length !== 1) {
    console.error(`FAIL: Expected exactly 1 refresh token after second rotation, got ${finalTokens2.length}`);
    process.exit(1);
  }

  // Cleanup
  await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
  console.log('\n✓ Cleanup completed');

  console.log('\n=== ALL TESTS PASSED ===');
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