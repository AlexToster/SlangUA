const testCases = [
  {
    name: 'Non-numeric auth_date',
    initData: 'user=%7B%22id%22%3A123456789%2C%22first_name%22%3A%22Test%22%2C%22last_name%22%3A%22User%22%2C%22username%22%3A%22testuser%22%2C%22language_code%22%3A%22en%22%2C%22is_premium%22%3Afalse%7D&auth_date=notanumber&hash=e4f9296906f047d374da56d9d27045ebd16868734d5ee67615db4c68ad0e0315',
    expectedCode: 'AUTH_DATE_INVALID',
    expectedStatus: 401
  },
  {
    name: 'auth_date 10 minutes in future (600 seconds)',
    initData: 'user=%7B%22id%22%3A123456789%2C%22first_name%22%3A%22Test%22%2C%22last_name%22%3A%22User%22%2C%22username%22%3A%22testuser%22%2C%22language_code%22%3A%22en%22%2C%22is_premium%22%3Afalse%7D&auth_date=1786103444&hash=0b2d7a03933a4ef9a4b3c15f6aa376989e2d3d50e1804027afe0572fead34d46',
    expectedCode: 'AUTH_DATE_FUTURE',
    expectedStatus: 401
  },
  {
    name: 'auth_date 60 seconds in future (within tolerance)',
    initData: 'user=%7B%22id%22%3A123456789%2C%22first_name%22%3A%22Test%22%2C%22last_name%22%3A%22User%22%2C%22username%22%3A%22testuser%22%2C%22language_code%22%3A%22en%22%2C%22is_premium%22%3Afalse%7D&auth_date=1786102904&hash=cdaa08fb057f47d2435f5c7cd06f1dd075519bf46ca648c4e27c961c9a929464',
    expectedCode: null, // should succeed
    expectedStatus: 200
  },
  {
    name: 'auth_date older than TTL (expired)',
    initData: 'user=%7B%22id%22%3A123456789%2C%22first_name%22%3A%22Test%22%2C%22last_name%22%3A%22User%22%2C%22username%22%3A%22testuser%22%2C%22language_code%22%3A%22en%22%2C%22is_premium%22%3Afalse%7D&auth_date=1786016344&hash=c8cb98782e64dfbc47902a2b02411abd7257e10e6f579627e2df29254a2cf97b',
    expectedCode: 'AUTH_DATE_EXPIRED',
    expectedStatus: 401
  },
  {
    name: 'Valid auth_date (current time)',
    initData: 'user=%7B%22id%22%3A123456789%2C%22first_name%22%3A%22Test%22%2C%22last_name%22%3A%22User%22%2C%22username%22%3A%22testuser%22%2C%22language_code%22%3A%22en%22%2C%22is_premium%22%3Afalse%7D&auth_date=1786102844&hash=5a0f39086f08e3850b047b2824f3c63066ecb88e82479c4368d18c1d95a3fbce',
    expectedCode: null, // should succeed
    expectedStatus: 200
  }
];

async function runTests() {
  for (const testCase of testCases) {
    console.log(`\n=== ${testCase.name} ===`);
    
    try {
      const response = await fetch('http://localhost:3000/api/v1/auth/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData: testCase.initData })
      });
      
      const data = await response.json();
      console.log(`Status: ${response.status}`);
      console.log(`Response:`, JSON.stringify(data, null, 2));
      
      if (testCase.expectedCode) {
        if (data.code === testCase.expectedCode && response.status === testCase.expectedStatus) {
          console.log('✅ PASS');
        } else {
          console.log(`❌ FAIL - Expected code: ${testCase.expectedCode}, status: ${testCase.expectedStatus}`);
        }
      } else {
        if (response.status === 200 && data.accessToken) {
          console.log('✅ PASS - Successfully authenticated');
        } else {
          console.log(`❌ FAIL - Expected success (200)`);
        }
      }
    } catch (error) {
      console.log(`❌ ERROR:`, error);
    }
  }
}

runTests();