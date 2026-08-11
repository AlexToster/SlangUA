async function testLogoutRevocation() {
  const BASE_URL = 'http://localhost:3000/api/v1';
  
  // First, we need a valid initData to authenticate
  // Use the valid test data
  const validInitData = 'user=%7B%22id%22%3A123456789%2C%22first_name%22%3A%22Test%22%2C%22last_name%22%3A%22User%22%2C%22username%22%3A%22testuser%22%2C%22language_code%22%3A%22en%22%2C%22is_premium%22%3Afalse%7D&auth_date=1786102844&hash=5a0f39086f08e3850b047b2824f3c63066ecb88e82479c4368d18c1d95a3fbce';
  
  console.log('=== Step 1: Authenticate (Session 1) ===');
  const authResponse1 = await fetch(`${BASE_URL}/auth/telegram`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData: validInitData })
  });
  
  const authData1 = await authResponse1.json();
  console.log(`Status: ${authResponse1.status}`);
  
  if (authResponse1.status !== 200 || !authData1.accessToken) {
    console.log('❌ Authentication failed');
    return;
  }
  
  const accessToken1 = authData1.accessToken;
  const refreshToken1 = authData1.refreshToken;
  console.log('✅ Session 1 Authentication successful');
  
  console.log('\n=== Step 2: Call authenticated route BEFORE logout (Session 1) ===');
  const beforeLogoutResponse = await fetch(`${BASE_URL}/user/me`, {
    headers: { 'Authorization': `Bearer ${accessToken1}` }
  });
  
  const beforeLogoutData = await beforeLogoutResponse.json();
  console.log(`Status: ${beforeLogoutResponse.status}`);
  
  if (beforeLogoutResponse.status !== 200) {
    console.log('❌ Before logout: expected 200');
    return;
  }
  console.log('✅ Before logout: 200 OK');
  
  console.log('\n=== Step 3: Create Session 2 (different login) ===');
  const authResponse2 = await fetch(`${BASE_URL}/auth/telegram`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData: validInitData })
  });
  
  const authData2 = await authResponse2.json();
  console.log(`Status: ${authResponse2.status}`);
  
  if (authResponse2.status !== 200 || !authData2.accessToken) {
    console.log('❌ Session 2 Authentication failed');
    return;
  }
  
  const accessToken2 = authData2.accessToken;
  const refreshToken2 = authData2.refreshToken;
  console.log('✅ Session 2 Authentication successful');
  
  console.log('\n=== Step 4: Call logout for Session 1 ===');
  const logoutResponse = await fetch(`${BASE_URL}/auth/logout`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken1}` }
  });
  
  console.log(`Status: ${logoutResponse.status}`);
  if (logoutResponse.status !== 204) {
    console.log('❌ Logout failed');
    return;
  }
  console.log('✅ Session 1 Logout successful (204)');
  
  console.log('\n=== Step 5: Call authenticated route AFTER logout (Session 1 token) ===');
  const afterLogoutResponse = await fetch(`${BASE_URL}/user/me`, {
    headers: { 'Authorization': `Bearer ${accessToken1}` }
  });
  
  const afterLogoutData = await afterLogoutResponse.json();
  console.log(`Status: ${afterLogoutResponse.status}`);
  console.log(`Response:`, JSON.stringify(afterLogoutData, null, 2));
  
  if (afterLogoutResponse.status !== 401) {
    console.log('❌ After logout: expected 401, got', afterLogoutResponse.status);
    return;
  }
  console.log('✅ Session 1 token revoked: 401 Unauthorized');
  
  console.log('\n=== Step 6: Verify Session 2 token STILL WORKS (unaffected) ===');
  const session2Response = await fetch(`${BASE_URL}/user/me`, {
    headers: { 'Authorization': `Bearer ${accessToken2}` }
  });
  
  const session2Data = await session2Response.json();
  console.log(`Status: ${session2Response.status}`);
  console.log(`Response:`, JSON.stringify(session2Data, null, 2));
  
  if (session2Response.status !== 200) {
    console.log('❌ Session 2 token: expected 200, got', session2Response.status);
    return;
  }
  console.log('✅ Session 2 token unaffected: 200 OK');
  
  console.log('\n=== Step 7: Verify Session 2 can refresh ===');
  const refreshResponse = await fetch(`${BASE_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: refreshToken2 })
  });
  
  const refreshData = await refreshResponse.json();
  console.log(`Status: ${refreshResponse.status}`);
  
  if (refreshResponse.status !== 200 || !refreshData.accessToken) {
    console.log('❌ Session 2 token refresh failed');
    return;
  }
  console.log('✅ Session 2 can refresh tokens');
  
  console.log('\n=== ALL TESTS PASSED ===');
}

testLogoutRevocation().catch(console.error);