const API_BASE = 'http://localhost:5000/api';

async function request(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok) {
    const error = new Error(data.message || `HTTP ${res.status}`);
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function runTests() {
  console.log('=== TESTING MANAGER ADD USER REPORTS TO HIERARCHY RULES ===\n');

  try {
    // 1. Log in as Super Admin to ensure Manager Asif & Wasil exist
    const superLogin = await request(`${API_BASE}/auth/login`, {
      method: 'POST',
      body: JSON.stringify({
        usernameOrEmail: 'sarfrajahamad068@gmail.com',
        password: '998466',
      }),
    });
    const superToken = superLogin.token;
    const superId = (superLogin.user._id || superLogin.user.id).toString();

    // Ensure Asif is Manager
    const asifSearch = await request(`${API_BASE}/users?search=asif`, {
      headers: { Authorization: `Bearer ${superToken}` },
    });
    const asifObj = asifSearch.users.find(u => u.username === 'asif' || u.name === 'Asif');
    await request(`${API_BASE}/users/${asifObj._id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${superToken}` },
      body: JSON.stringify({ role: 'Manager', password: 'asifpassword123' }),
    });

    // Ensure Wasil reports to Asif
    const wasilSearch = await request(`${API_BASE}/users?search=wasil`, {
      headers: { Authorization: `Bearer ${superToken}` },
    });
    const wasilObj = wasilSearch.users.find(u => u.username === 'wasil' || u.name === 'Wasil');
    await request(`${API_BASE}/users/${wasilObj._id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${superToken}` },
      body: JSON.stringify({ role: 'User', reportsTo: asifObj._id, reportsToName: 'Asif (Manager)' }),
    });

    // 2. Log in as Manager Asif
    const asifLogin = await request(`${API_BASE}/auth/login`, {
      method: 'POST',
      body: JSON.stringify({
        usernameOrEmail: 'asif',
        password: 'asifpassword123',
      }),
    });
    const asifToken = asifLogin.token;
    const asifId = (asifLogin.user._id || asifLogin.user.id).toString();
    console.log('1. Logged in as Manager:', asifLogin.user.name);

    // 3. Check users list seen by Manager Asif
    const asifUsersRes = await request(`${API_BASE}/users`, {
      headers: { Authorization: `Bearer ${asifToken}` },
    });
    console.log('2. Users in Asif branch:', asifUsersRes.users.map(u => `${u.name} (${u.role})`));
    const asifHasSuperAdmin = asifUsersRes.users.some(u => u.role === 'Super Admin');
    if (asifHasSuperAdmin) {
      throw new Error('Manager should not see Super Admin in his team /api/users list');
    }
    console.log('   PASS: Super Admin is NOT in manager scoped users list!');

    // 4. As Manager, create a new user reporting to subordinate Wasil
    const uniqueEmail = `kiran_${Date.now()}@example.com`;
    const uniqueUsername = `kiran_${Date.now()}`;
    const createUnderWasilRes = await request(`${API_BASE}/users`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${asifToken}` },
      body: JSON.stringify({
        name: 'Kiran Junior',
        email: uniqueEmail,
        username: uniqueUsername,
        password: 'kiranpassword',
        department: 'Documentation',
        reportsTo: wasilObj._id,
      }),
    });

    console.log('3. Manager created user under subordinate Wasil:', createUnderWasilRes.user.name, {
      role: createUnderWasilRes.user.role,
      reportsTo: createUnderWasilRes.user.reportsTo,
      reportsToName: createUnderWasilRes.user.reportsToName,
    });

    if (createUnderWasilRes.user.reportsTo.toString() !== wasilObj._id.toString()) {
      throw new Error(`Expected reportsTo '${wasilObj._id}', got '${createUnderWasilRes.user.reportsTo}'`);
    }
    console.log('   PASS: User was successfully assigned to report to subordinate Wasil!');

    // 5. Check hierarchy tree for Manager Asif
    const asifHierarchyRes = await request(`${API_BASE}/hierarchy`, {
      headers: { Authorization: `Bearer ${asifToken}` },
    });
    const asifTree = asifHierarchyRes.hierarchy;
    console.log('4. Manager Hierarchy Tree Root:', asifTree.name);
    const wasilNode = asifTree.children.find(c => c._id.toString() === wasilObj._id.toString());
    if (!wasilNode) {
      throw new Error('Wasil node not found under Asif tree');
    }
    const kiranUnderWasil = wasilNode.children.find(c => c.name === 'Kiran Junior');
    if (!kiranUnderWasil) {
      throw new Error('Kiran Junior node not found under Wasil node in hierarchy tree');
    }
    console.log('   PASS: Hierarchy tree correctly shows Asif -> Wasil -> Kiran Junior!');

    // 6. Test blocking Manager assigning user to report to Super Admin (senior outside branch)
    console.log('5. Testing Manager attempting to assign user to report to Super Admin...');
    let blocked = false;
    try {
      await request(`${API_BASE}/users`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${asifToken}` },
        body: JSON.stringify({
          name: 'Invalid User',
          email: `invalid_${Date.now()}@example.com`,
          username: `invalid_${Date.now()}`,
          password: 'password123',
          department: 'Operations',
          reportsTo: superId,
        }),
      });
    } catch (err) {
      blocked = true;
      console.log('   PASS: Blocked as expected:', err.data?.message || err.message);
    }
    if (!blocked) {
      throw new Error('Manager assigning user to Super Admin should have been rejected');
    }

    console.log('\n=== ALL MANAGER REPORTS TO TESTS PASSED (100%) ===\n');
  } catch (err) {
    console.error('TEST FAILED:', err.data || err.message);
    process.exit(1);
  }
}

runTests();
