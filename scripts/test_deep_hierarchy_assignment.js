const assert = require('assert');

async function testDeepHierarchy() {
  console.log('=================================================================');
  console.log('🧪 TESTING DEEP MULTI-LEVEL HIERARCHY TASK ASSIGNMENT');
  console.log('   (Manager Asif -> User Wasil -> Lowest User Rishu)');
  console.log('=================================================================\n');

  const baseUrl = 'http://localhost:5000/api';

  // 1. Super Admin Login
  console.log('Step 1: Logging in as Super Admin (sarfrajahamad068@gmail.com)...');
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
  const superHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${superData.token}`,
  };
  console.log(`✓ Super Admin logged in: ${superData.user.name} (${superData.user.role})`);

  // 2. Set up Hierarchy:
  // Asif (Manager) -> Wasil (User, reportsTo Asif) -> Rishu (User, reportsTo Wasil)
  console.log('\nStep 2: Setting up 3-tier hierarchy (Asif -> Wasil -> Rishu)...');

  // Find or Create Asif
  const asifRes = await fetch(`${baseUrl}/users?search=asif`, { headers: superHeaders });
  const asifData = await asifRes.json();
  let asifUser = asifData.users.find(u => u.username === 'asif' || u.name.toLowerCase().includes('asif'));
  if (!asifUser) {
    const createAsif = await fetch(`${baseUrl}/users`, {
      method: 'POST',
      headers: superHeaders,
      body: JSON.stringify({
        name: 'Asif Manager',
        email: 'asif@taskflow.com',
        username: 'asif',
        password: 'user123',
        role: 'Manager',
        department: 'Operations',
      }),
    });
    const createAsifData = await createAsif.json();
    asifUser = createAsifData.user;
  } else {
    // Ensure role is Manager
    await fetch(`${baseUrl}/users/${asifUser._id}`, {
      method: 'PUT',
      headers: superHeaders,
      body: JSON.stringify({ role: 'Manager' }),
    });
  }
  console.log(`✓ Manager Asif ready (ID: ${asifUser._id})`);

  // Find or Create Wasil (reports to Asif)
  const wasilRes = await fetch(`${baseUrl}/users?search=wasil`, { headers: superHeaders });
  const wasilData = await wasilRes.json();
  let wasilUser = wasilData.users.find(u => u.username === 'wasil' || u.name.toLowerCase().includes('wasil'));
  if (!wasilUser) {
    const createWasil = await fetch(`${baseUrl}/users`, {
      method: 'POST',
      headers: superHeaders,
      body: JSON.stringify({
        name: 'Wasil Team Lead',
        email: 'wasil@taskflow.com',
        username: 'wasil',
        password: 'user123',
        role: 'User',
        department: 'Operations',
        reportsTo: asifUser._id,
        reportsToName: `${asifUser.name} (Manager)`,
      }),
    });
    const createWasilData = await createWasil.json();
    wasilUser = createWasilData.user;
  } else {
    await fetch(`${baseUrl}/users/${wasilUser._id}`, {
      method: 'PUT',
      headers: superHeaders,
      body: JSON.stringify({
        role: 'User',
        reportsTo: asifUser._id,
        reportsToName: `${asifUser.name} (Manager)`,
      }),
    });
  }
  console.log(`✓ User Wasil ready, reports to Asif (ID: ${wasilUser._id})`);

  // Find or Create Rishu (reports to Wasil - lowest user)
  const rishuRes = await fetch(`${baseUrl}/users?search=rishu`, { headers: superHeaders });
  const rishuData = await rishuRes.json();
  let rishuUser = rishuData.users.find(u => u.username === 'rishu' || u.name.toLowerCase().includes('rishu'));
  if (!rishuUser) {
    const createRishu = await fetch(`${baseUrl}/users`, {
      method: 'POST',
      headers: superHeaders,
      body: JSON.stringify({
        name: 'Rishu Junior',
        email: 'rishu@taskflow.com',
        username: 'rishu',
        password: 'user123',
        role: 'User',
        department: 'Operations',
        reportsTo: wasilUser._id,
        reportsToName: `${wasilUser.name} (User)`,
      }),
    });
    const createRishuData = await createRishu.json();
    rishuUser = createRishuData.user;
  } else {
    await fetch(`${baseUrl}/users/${rishuUser._id}`, {
      method: 'PUT',
      headers: superHeaders,
      body: JSON.stringify({
        role: 'User',
        reportsTo: wasilUser._id,
        reportsToName: `${wasilUser.name} (User)`,
      }),
    });
  }
  console.log(`✓ Lowest User Rishu ready, reports to Wasil (ID: ${rishuUser._id})`);

  // Find or Create Unrelated User (Shoaib - not connected to Asif)
  const shoaibRes = await fetch(`${baseUrl}/users?search=shoaib`, { headers: superHeaders });
  const shoaibData = await shoaibRes.json();
  let shoaibUser = shoaibData.users.find(u => u.username === 'shoaib' || u.name.toLowerCase().includes('shoaib'));
  if (shoaibUser) {
    await fetch(`${baseUrl}/users/${shoaibUser._id}`, {
      method: 'PUT',
      headers: superHeaders,
      body: JSON.stringify({
        reportsTo: null,
        reportsToName: '',
      }),
    });
  }

  // 3. Authenticate as Manager Asif
  console.log('\nStep 3: Authenticating as Manager Asif...');
  const asifLoginRes = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      usernameOrEmail: asifUser.email || asifUser.username,
      password: 'user123',
    }),
  });
  const asifLoginData = await asifLoginRes.json();
  assert.strictEqual(asifLoginData.success, true);
  const asifHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${asifLoginData.token}`,
  };

  // 4. Authenticate as User Wasil
  console.log('Step 4: Authenticating as User Wasil...');
  const wasilLoginRes = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      usernameOrEmail: wasilUser.email || wasilUser.username,
      password: 'user123',
    }),
  });
  const wasilLoginData = await wasilLoginRes.json();
  assert.strictEqual(wasilLoginData.success, true);
  const wasilHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${wasilLoginData.token}`,
  };

  // 5. Authenticate as User Rishu
  console.log('Step 5: Authenticating as Lowest User Rishu...');
  const rishuLoginRes = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      usernameOrEmail: rishuUser.email || rishuUser.username,
      password: 'user123',
    }),
  });
  const rishuLoginData = await rishuLoginRes.json();
  assert.strictEqual(rishuLoginData.success, true);
  const rishuHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${rishuLoginData.token}`,
  };

  console.log('\n=================================================================');
  console.log('📋 RUNNING HIERARCHY ASSIGNMENT TEST CASES');
  console.log('=================================================================');

  // Test Case 1: Manager Asif assigns task to lowest user Rishu (indirect subordinate 2 levels down)
  console.log('\n[Test 1] Manager (Asif) assigns task to lowest user (Rishu) 2 levels down...');
  const t1Res = await fetch(`${baseUrl}/tasks`, {
    method: 'POST',
    headers: asifHeaders,
    body: JSON.stringify({
      taskType: 'internet work',
      description: 'Manager Asif direct assignment to lowest user Rishu',
      expectedDate: new Date(Date.now() + 86400000 * 3).toISOString(),
      assignedTo: rishuUser.name,
      status: 'To Do',
    }),
  });
  const t1Data = await t1Res.json();
  assert.strictEqual(t1Res.status, 201, `Manager MUST be able to assign task to lowest user Rishu. Response: ${JSON.stringify(t1Data)}`);
  assert.strictEqual(t1Data.success, true);
  console.log(`✅ SUCCESS: Manager Asif assigned task to lowest user Rishu! (Task ID: ${t1Data.task._id})`);

  // Test Case 2: User Wasil assigns task to lowest user Rishu (direct subordinate 1 level down)
  console.log('\n[Test 2] User (Wasil) assigns task to lowest user (Rishu)...');
  const t2Res = await fetch(`${baseUrl}/tasks`, {
    method: 'POST',
    headers: wasilHeaders,
    body: JSON.stringify({
      taskType: 'documentation',
      description: 'Wasil assigned documentation task to Rishu',
      expectedDate: new Date(Date.now() + 86400000 * 2).toISOString(),
      assignedTo: rishuUser.name,
      status: 'To Do',
    }),
  });
  const t2Data = await t2Res.json();
  assert.strictEqual(t2Res.status, 201, `User Wasil MUST be able to assign task to Rishu. Response: ${JSON.stringify(t2Data)}`);
  assert.strictEqual(t2Data.success, true);
  console.log(`✅ SUCCESS: User Wasil assigned task to Rishu! (Task ID: ${t2Data.task._id})`);

  // Test Case 3: Lowest user Rishu tries to assign task to senior Wasil -> REJECTED
  console.log('\n[Test 3] Lowest user (Rishu) tries to assign task to senior (Wasil)...');
  const t3Res = await fetch(`${baseUrl}/tasks`, {
    method: 'POST',
    headers: rishuHeaders,
    body: JSON.stringify({
      taskType: 'backend work',
      description: 'Illegal assignment from junior to senior',
      expectedDate: new Date(Date.now() + 86400000).toISOString(),
      assignedTo: wasilUser.name,
      status: 'To Do',
    }),
  });
  const t3Data = await t3Res.json();
  assert.strictEqual(t3Res.status, 400, 'Junior assigning to senior MUST be rejected');
  assert.strictEqual(t3Data.success, false);
  console.log(`✅ SUCCESS: Correctly blocked junior assignment to senior (${t3Data.message})`);

  // Test Case 4: Lowest user Rishu tries to assign task to Manager Asif -> REJECTED
  console.log('\n[Test 4] Lowest user (Rishu) tries to assign task to Manager (Asif)...');
  const t4Res = await fetch(`${baseUrl}/tasks`, {
    method: 'POST',
    headers: rishuHeaders,
    body: JSON.stringify({
      taskType: 'backend work',
      description: 'Illegal assignment from junior to manager',
      expectedDate: new Date(Date.now() + 86400000).toISOString(),
      assignedTo: asifUser.name,
      status: 'To Do',
    }),
  });
  const t4Data = await t4Res.json();
  assert.strictEqual(t4Res.status, 400, 'Junior assigning to manager MUST be rejected');
  assert.strictEqual(t4Data.success, false);
  console.log(`✅ SUCCESS: Correctly blocked junior assignment to manager (${t4Data.message})`);

  // Test Case 5: Manager Asif tries to assign task to Super Admin -> REJECTED
  console.log('\n[Test 5] Manager (Asif) tries to assign task to Senior (Super Admin)...');
  const t5Res = await fetch(`${baseUrl}/tasks`, {
    method: 'POST',
    headers: asifHeaders,
    body: JSON.stringify({
      taskType: 'social media',
      description: 'Manager assignment to super admin',
      expectedDate: new Date(Date.now() + 86400000).toISOString(),
      assignedTo: superData.user.name,
      status: 'To Do',
    }),
  });
  const t5Data = await t5Res.json();
  assert.strictEqual(t5Res.status, 400, 'Manager assigning to Super Admin MUST be rejected');
  assert.strictEqual(t5Data.success, false);
  console.log(`✅ SUCCESS: Correctly blocked manager assignment to Super Admin (${t5Data.message})`);

  // Test Case 6: Self-assignment attempts -> REJECTED
  console.log('\n[Test 6] Self-assignment tests for Asif and Wasil...');
  const selfAsif = await fetch(`${baseUrl}/tasks`, {
    method: 'POST',
    headers: asifHeaders,
    body: JSON.stringify({
      taskType: 'sells',
      description: 'Self assignment attempt',
      expectedDate: new Date().toISOString(),
      assignedTo: asifUser.name,
      status: 'To Do',
    }),
  });
  const selfAsifData = await selfAsif.json();
  assert.strictEqual(selfAsif.status, 400, 'Self-assignment must be rejected');
  assert.strictEqual(selfAsifData.success, false);
  console.log(`✅ SUCCESS: Correctly blocked self-assignment (${selfAsifData.message})`);

  // Test Case 7: Manager Asif assigning to unrelated user (Shoaib) -> REJECTED
  if (shoaibUser) {
    console.log('\n[Test 7] Manager (Asif) assigning task to unrelated user (Shoaib)...');
    const t7Res = await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: asifHeaders,
      body: JSON.stringify({
        taskType: 'internet work',
        description: 'Assignment to outside hierarchy member',
        expectedDate: new Date().toISOString(),
        assignedTo: shoaibUser.name,
        status: 'To Do',
      }),
    });
    const t7Data = await t7Res.json();
    assert.strictEqual(t7Res.status, 400, 'Assigning outside hierarchy must be rejected');
    assert.strictEqual(t7Data.success, false);
    console.log(`✅ SUCCESS: Correctly blocked assignment to outside user (${t7Data.message})`);
  }

  // Test Case 8: Super Admin assigning task to lowest user Rishu -> SUCCEED
  console.log('\n[Test 8] Super Admin assigning task to lowest user (Rishu)...');
  const t8Res = await fetch(`${baseUrl}/tasks`, {
    method: 'POST',
    headers: superHeaders,
    body: JSON.stringify({
      taskType: 'backend work',
      description: 'Super Admin assigned task to lowest user Rishu',
      expectedDate: new Date(Date.now() + 86400000 * 5).toISOString(),
      assignedTo: rishuUser.name,
      status: 'To Do',
    }),
  });
  const t8Data = await t8Res.json();
  assert.strictEqual(t8Res.status, 201);
  assert.strictEqual(t8Data.success, true);
  console.log(`✅ SUCCESS: Super Admin assigned task to lowest user Rishu!`);

  console.log('\n=================================================================');
  console.log('🎉 ALL MULTI-LEVEL HIERARCHY TESTS PASSED WITH 100% SUCCESS!');
  console.log('=================================================================\n');
}

testDeepHierarchy().catch((err) => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
