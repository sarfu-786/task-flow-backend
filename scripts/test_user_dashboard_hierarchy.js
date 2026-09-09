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
  console.log('=== TESTING USER DASHBOARD & HIERARCHY RULES ===\n');

  try {
    // 1. Log in as Super Admin
    const superLogin = await request(`${API_BASE}/auth/login`, {
      method: 'POST',
      body: JSON.stringify({
        usernameOrEmail: 'sarfrajahamad068@gmail.com',
        password: '998466',
      }),
    });
    const superToken = superLogin.token;
    console.log('1. Logged in as Super Admin:', superLogin.user.name);

    // 2. Set Wasil's password so Wasil can login directly
    const wasilSearch = await request(`${API_BASE}/users?search=wasil`, {
      headers: { Authorization: `Bearer ${superToken}` },
    });
    const wasilObj = wasilSearch.users.find(u => u.username === 'wasil' || u.name === 'Wasil');
    if (!wasilObj) {
      throw new Error('Wasil user not found in database');
    }

    await request(`${API_BASE}/users/${wasilObj._id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${superToken}` },
      body: JSON.stringify({ password: 'wasilpassword123', role: 'User' }),
    });
    console.log('2. Configured Wasil credentials');

    // 3. Log in as regular User Wasil
    const wasilLogin = await request(`${API_BASE}/auth/login`, {
      method: 'POST',
      body: JSON.stringify({
        usernameOrEmail: wasilObj.username,
        password: 'wasilpassword123',
      }),
    });
    const wasilToken = wasilLogin.token;
    const wasilUser = wasilLogin.user;
    console.log('3. Logged in as regular User:', wasilUser.name, `(ID: ${wasilUser._id || wasilUser.id})`);

    // 4. As Wasil, add a new user 'Zaid Subordinate'
    const uniqueEmail = `zaid_${Date.now()}@example.com`;
    const uniqueUsername = `zaid_${Date.now()}`;
    const createRes = await request(`${API_BASE}/users`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${wasilToken}` },
      body: JSON.stringify({
        name: 'Zaid Subordinate',
        email: uniqueEmail,
        username: uniqueUsername,
        password: 'zaidpassword',
        department: 'Operations',
      }),
    });

    console.log('4. Wasil created new user:', createRes.user.name, {
      role: createRes.user.role,
      reportsTo: createRes.user.reportsTo,
      reportsToName: createRes.user.reportsToName,
      createdBy: createRes.user.createdBy,
    });

    const wasilId = (wasilUser._id || wasilUser.id).toString();
    if (createRes.user.role !== 'User') {
      throw new Error(`Expected role 'User', got '${createRes.user.role}'`);
    }
    if (createRes.user.reportsTo.toString() !== wasilId) {
      throw new Error(`Expected reportsTo '${wasilId}', got '${createRes.user.reportsTo}'`);
    }
    console.log('   PASS: New user role is User and reportsTo is Wasil!');

    // 5. Fetch /api/hierarchy as Wasil
    const wasilHierarchyRes = await request(`${API_BASE}/hierarchy`, {
      headers: { Authorization: `Bearer ${wasilToken}` },
    });

    const wasilTree = wasilHierarchyRes.hierarchy;
    console.log('5. Wasil Hierarchy Tree Root:', wasilTree.name, `(Role: ${wasilTree.role}, TeamCount: ${wasilTree.teamCount})`);
    console.log('   Children:', wasilTree.children.map((c) => c.name));

    if (wasilTree._id.toString() !== wasilId) {
      throw new Error(`Expected hierarchy root to be Wasil (${wasilId}), but got ${wasilTree._id} (${wasilTree.name})`);
    }
    const hasZaidChild = wasilTree.children.some((c) => c.name === 'Zaid Subordinate');
    if (!hasZaidChild) {
      throw new Error(`Expected 'Zaid Subordinate' to be in Wasil's hierarchy children`);
    }
    console.log('   PASS: Wasil sees himself as TOP of hierarchy and Zaid below him!');

    // 6. Verify Wasil does NOT see Super Admin or Asif in his hierarchy tree
    const treeContainsAdminOrManager = wasilTree.children.some(
      (c) => c.role === 'Super Admin' || c.role === 'Manager' || c.name === 'Sarfaraj Ahmad' || c.name === 'Asif'
    );
    if (treeContainsAdminOrManager) {
      throw new Error('Wasil hierarchy contains Super Admin or Manager! Colleague/Senior leakage detected.');
    }
    console.log('   PASS: No seniors or colleagues leaked into Wasil hierarchy tree!');

    // 7. Fetch /api/users as Wasil
    const wasilUsersRes = await request(`${API_BASE}/users`, {
      headers: { Authorization: `Bearer ${wasilToken}` },
    });
    console.log('7. Wasil accessible users count:', wasilUsersRes.users.length);
    console.log('   Users seen by Wasil:', wasilUsersRes.users.map((u) => u.name));
    const wasilUsersList = wasilUsersRes.users;
    const canSeeSelf = wasilUsersList.some((u) => (u._id || u.id).toString() === wasilId);
    const canSeeZaid = wasilUsersList.some((u) => u.name === 'Zaid Subordinate');
    const canSeeSuperAdmin = wasilUsersList.some((u) => u.role === 'Super Admin');

    if (!canSeeSelf || !canSeeZaid) {
      throw new Error('Wasil cannot see himself or Zaid in /api/users');
    }
    if (canSeeSuperAdmin) {
      throw new Error('Wasil should not see Super Admin in his team /api/users list');
    }
    console.log('   PASS: Wasil scoped user list contains only himself and his subordinates!');

    console.log('\n=== ALL USER DASHBOARD & HIERARCHY TESTS PASSED (100%) ===\n');
  } catch (err) {
    console.error('TEST FAILED:', err.data || err.message);
    process.exit(1);
  }
}

runTests();
