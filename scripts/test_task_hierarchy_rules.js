const assert = require('assert');

async function runHierarchyVerification() {
  console.log('=================================================================');
  console.log('🧪 TESTING TASK ASSIGNMENT HIERARCHY RULES & USER TERMINOLOGY');
  console.log('=================================================================\n');

  const baseUrl = 'http://localhost:5000/api';

  // 1. Authenticate as Super Admin
  console.log('Step 1: Logging in as Super Admin (sarfraj)...');
  const superLoginRes = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      usernameOrEmail: 'sarfrajahamad068@gmail.com',
      password: '998466',
    }),
  });
  const superData = await superLoginRes.json();
  assert.strictEqual(superData.success, true, 'Super Admin login must succeed');
  const superToken = superData.token;
  const superHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${superToken}`,
  };
  console.log(`✓ Super Admin logged in: ${superData.user.name} (${superData.user.role})`);

  // Ensure we have a Manager and a User reporting to that Manager for testing
  console.log('\nStep 2: Checking/Setting up Manager & Junior User hierarchy...');
  // Update Asif to be a Manager
  const asifUserRes = await fetch(`${baseUrl}/users?search=asif`, { headers: superHeaders });
  const asifUserData = await asifUserRes.json();
  const asifUser = asifUserData.users.find(u => u.username === 'asif' || u.name === 'Asif');
  
  if (asifUser) {
    await fetch(`${baseUrl}/users/${asifUser._id}`, {
      method: 'PUT',
      headers: superHeaders,
      body: JSON.stringify({ role: 'Manager' }),
    });
    console.log(`✓ Asif role confirmed as Manager`);
  }

  // Update Wasil to report to Asif
  const wasilRes = await fetch(`${baseUrl}/users?search=wasil`, { headers: superHeaders });
  const wasilData = await wasilRes.json();
  const wasilUser = wasilData.users.find(u => u.username === 'wasil' || u.name === 'Wasil');
  if (wasilUser && asifUser) {
    await fetch(`${baseUrl}/users/${wasilUser._id}`, {
      method: 'PUT',
      headers: superHeaders,
      body: JSON.stringify({
        role: 'User',
        reportsTo: asifUser._id,
        reportsToName: `${asifUser.name} (Manager)`,
      }),
    });
    console.log(`✓ Wasil configured as Junior reporting to Asif`);
  }

  // Update Shoaib to report to Super Admin or be an independent user
  const shoaibRes = await fetch(`${baseUrl}/users?search=shoaib`, { headers: superHeaders });
  const shoaibData = await shoaibRes.json();
  const shoaibUser = shoaibData.users.find(u => u.username === 'shoaib' || u.name === 'Shoaib Khan');

  // Authenticate as Manager (Asif)
  const managerLoginRes = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      usernameOrEmail: 'asif@gmail.com',
      password: 'user123',
    }),
  });
  const managerData = await managerLoginRes.json();
  assert.strictEqual(managerData.success, true);
  const managerToken = managerData.token;
  const managerHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${managerToken}`,
  };
  console.log(`✓ Manager (Asif) authenticated`);

  // Authenticate as User (Wasil)
  const userLoginRes = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      usernameOrEmail: 'wasil@gmail.com',
      password: 'user123',
    }),
  });
  const userData = await userLoginRes.json();
  assert.strictEqual(userData.success, true);
  const userToken = userData.token;
  const userHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${userToken}`,
  };
  console.log(`✓ User (Wasil) authenticated`);

  console.log('\n--- TEST CASES ---');

  // Test Case 1: Super Admin assigns task to a regular User (e.g. Wasil)
  console.log('\nTest Case 1: Super Admin assigning task to regular User (Wasil)...');
  const t1Res = await fetch(`${baseUrl}/tasks`, {
    method: 'POST',
    headers: superHeaders,
    body: JSON.stringify({
      taskType: 'backend work',
      description: 'Super Admin assigned task to Wasil',
      expectedDate: new Date(Date.now() + 86400000 * 3).toISOString(),
      assignedTo: 'Wasil',
      status: 'To Do',
    }),
  });
  const t1Data = await t1Res.json();
  assert.strictEqual(t1Res.status, 201, 'Super Admin MUST be able to assign task to any user');
  assert.strictEqual(t1Data.success, true);
  console.log('✓ SUCCESS: Super Admin successfully assigned task to Wasil');

  // Test Case 2: Super Admin assigns task to himself -> REJECTED
  console.log('\nTest Case 2: Super Admin assigning task to himself (Sarfaraj Ahmad)...');
  const t2Res = await fetch(`${baseUrl}/tasks`, {
    method: 'POST',
    headers: superHeaders,
    body: JSON.stringify({
      taskType: 'documentation',
      description: 'Self-assignment attempt by Super Admin',
      expectedDate: new Date(Date.now() + 86400000 * 3).toISOString(),
      assignedTo: 'Sarfaraj Ahmad',
      status: 'To Do',
    }),
  });
  const t2Data = await t2Res.json();
  assert.strictEqual(t2Res.status, 400, 'Super Admin self-assignment MUST be rejected');
  assert.strictEqual(t2Data.success, false);
  console.log(`✓ SUCCESS: Blocked as expected (${t2Data.message})`);

  // Test Case 3: Manager assigns task to his direct junior (Wasil)
  console.log('\nTest Case 3: Manager (Asif) assigning task to his junior subordinate (Wasil)...');
  const t3Res = await fetch(`${baseUrl}/tasks`, {
    method: 'POST',
    headers: managerHeaders,
    body: JSON.stringify({
      taskType: 'internet work',
      description: 'Manager assigned task to junior Wasil',
      expectedDate: new Date(Date.now() + 86400000 * 4).toISOString(),
      assignedTo: 'Wasil',
      status: 'To Do',
    }),
  });
  const t3Data = await t3Res.json();
  if (!t3Data.success) {
    console.log('Test 3 Failed response:', t3Data);
  }
  assert.strictEqual(t3Res.status, 201, 'Manager MUST be able to assign task to junior subordinate');
  assert.strictEqual(t3Data.success, true);
  console.log('✓ SUCCESS: Manager successfully assigned task to junior subordinate');

  // Test Case 4: Manager assigns task to Senior (Super Admin: Sarfaraj Ahmad) -> REJECTED
  console.log('\nTest Case 4: Manager (Asif) assigning task to Senior (Super Admin: Sarfaraj Ahmad)...');
  const t4Res = await fetch(`${baseUrl}/tasks`, {
    method: 'POST',
    headers: managerHeaders,
    body: JSON.stringify({
      taskType: 'social media',
      description: 'Manager illegal assignment to Super Admin',
      expectedDate: new Date(Date.now() + 86400000 * 2).toISOString(),
      assignedTo: 'Sarfaraj Ahmad',
      status: 'To Do',
    }),
  });
  const t4Data = await t4Res.json();
  assert.strictEqual(t4Res.status, 400, 'Manager assigning to Senior MUST be rejected');
  assert.strictEqual(t4Data.success, false);
  console.log(`✓ SUCCESS: Blocked as expected (${t4Data.message})`);

  // Test Case 5: Manager assigns task to himself -> REJECTED
  console.log('\nTest Case 5: Manager (Asif) assigning task to himself...');
  const t5Res = await fetch(`${baseUrl}/tasks`, {
    method: 'POST',
    headers: managerHeaders,
    body: JSON.stringify({
      taskType: 'internet work',
      description: 'Manager self-assignment attempt',
      expectedDate: new Date(Date.now() + 86400000 * 2).toISOString(),
      assignedTo: 'Asif',
      status: 'To Do',
    }),
  });
  const t5Data = await t5Res.json();
  assert.strictEqual(t5Res.status, 400, 'Manager self-assignment MUST be rejected');
  assert.strictEqual(t5Data.success, false);
  console.log(`✓ SUCCESS: Blocked as expected (${t5Data.message})`);

  // Test Case 6: Manager assigns task to a user who is NOT their junior (Shoaib Khan) -> REJECTED
  console.log('\nTest Case 6: Manager (Asif) assigning task to a non-junior user (Shoaib Khan)...');
  const t6Res = await fetch(`${baseUrl}/tasks`, {
    method: 'POST',
    headers: managerHeaders,
    body: JSON.stringify({
      taskType: 'internet work',
      description: 'Manager assignment to non-subordinate',
      expectedDate: new Date(Date.now() + 86400000 * 2).toISOString(),
      assignedTo: 'Shoaib Khan',
      status: 'To Do',
    }),
  });
  const t6Data = await t6Res.json();
  assert.strictEqual(t6Res.status, 400, 'Manager assigning to non-junior user MUST be rejected');
  assert.strictEqual(t6Data.success, false);
  console.log(`✓ SUCCESS: Blocked as expected (${t6Data.message})`);

  // Test Case 7: Regular User (Wasil) tries to assign task to anyone -> REJECTED
  console.log('\nTest Case 7: Regular User (Wasil) trying to assign task...');
  const t7Res = await fetch(`${baseUrl}/tasks`, {
    method: 'POST',
    headers: userHeaders,
    body: JSON.stringify({
      taskType: 'internet work',
      description: 'User unauthorized assignment attempt',
      expectedDate: new Date(Date.now() + 86400000 * 2).toISOString(),
      assignedTo: 'Asif',
      status: 'To Do',
    }),
  });
  const t7Data = await t7Res.json();
  assert.strictEqual(t7Res.status, 400, 'Regular user assigning task MUST be rejected');
  assert.strictEqual(t7Data.success, false);
  console.log(`✓ SUCCESS: Blocked as expected (${t7Data.message})`);

  console.log('\n=================================================================');
  console.log('🎉 ALL HIERARCHY RULES & ASSIGNMENT TESTS PASSED PERFECTLY!');
  console.log('=================================================================\n');
}

runHierarchyVerification().catch((err) => {
  console.error('\n❌ VERIFICATION TEST FAILED:', err);
  process.exit(1);
});
