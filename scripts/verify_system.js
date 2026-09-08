const assert = require('assert');

async function runSystemVerification() {
  console.log('=================================================================');
  console.log('🧪 RUNNING COMPREHENSIVE ENTERPRISE SYSTEM VERIFICATION SUITE');
  console.log('=================================================================\n');

  const baseUrl = 'http://localhost:5000/api';

  // 1. Authenticate as Super Admin
  console.log('Step 1: Authenticating as Super Admin (Sarfaraj Ahmad)...');
  const superAdminLoginRes = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      usernameOrEmail: 'sarfrajahamad068@gmail.com',
      password: '998466',
    }),
  });
  const superAdminData = await superAdminLoginRes.json();
  assert.strictEqual(superAdminLoginRes.status, 200, 'Super admin login should return 200');
  assert.strictEqual(superAdminData.success, true);
  assert.strictEqual(superAdminData.user.role, 'Super Admin', 'Role must be Super Admin');
  const superAdminToken = superAdminData.token;
  const superAdminHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${superAdminToken}`,
  };
  console.log(`✓ Super Admin authenticated successfully: ${superAdminData.user.name} (Role: ${superAdminData.user.role})\n`);

  // 2. Authenticate as Manager (Asif)
  console.log('Step 2: Authenticating as Manager (Asif)...');
  const managerLoginRes = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      usernameOrEmail: 'asif@gmail.com',
      password: 'user123',
    }),
  });
  const managerData = await managerLoginRes.json();
  assert.strictEqual(managerLoginRes.status, 200, 'Manager login should return 200');
  assert.strictEqual(managerData.success, true);
  assert.strictEqual(managerData.user.role, 'Manager', 'Role must be Manager');
  const managerToken = managerData.token;
  const managerHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${managerToken}`,
  };
  console.log(`✓ Manager authenticated successfully: ${managerData.user.name} (Role: ${managerData.user.role})\n`);

  // 3. Authenticate as Employee (Arif)
  console.log('Step 3: Authenticating as Employee (Arif)...');
  const employeeLoginRes = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      usernameOrEmail: 'arif@gmail.com',
      password: 'user123',
    }),
  });
  const employeeData = await employeeLoginRes.json();
  assert.strictEqual(employeeLoginRes.status, 200, 'Employee login should return 200');
  assert.strictEqual(employeeData.success, true);
  assert.strictEqual(employeeData.user.role, 'User', 'Role must be User');
  console.log(`✓ Employee authenticated successfully: ${employeeData.user.name} (Role: ${employeeData.user.role})\n`);

  // 4. Test Dynamic Hierarchy Tree Generation (/api/hierarchy)
  console.log('Step 4: Fetching Dynamic Organizational Hierarchy (/api/hierarchy)...');
  const hierRes = await fetch(`${baseUrl}/hierarchy`, { headers: superAdminHeaders });
  const hierData = await hierRes.json();
  assert.strictEqual(hierRes.status, 200);
  assert.strictEqual(hierData.success, true);
  assert.ok(hierData.hierarchy, 'Hierarchy root must exist');
  assert.strictEqual(hierData.hierarchy.role, 'Super Admin', 'Root node must be Super Admin');
  assert.ok(Array.isArray(hierData.hierarchy.children), 'Hierarchy root must have children array');
  console.log(`✓ Root Node: ${hierData.hierarchy.name} (${hierData.hierarchy.role})`);
  console.log(`✓ Direct Branches under Super Admin: ${hierData.hierarchy.children.length}`);
  hierData.hierarchy.children.forEach((branch, idx) => {
    console.log(`   ├── Branch ${idx + 1}: ${branch.name} (${branch.role}) with ${branch.children?.length || 0} direct subordinates and ${branch.teamCount} total in team`);
    if (branch.children) {
      branch.children.forEach((subChild, cIdx) => {
        console.log(`   │   └── Sub-Branch ${cIdx + 1}: ${subChild.name} (${subChild.role}) with ${subChild.children?.length || 0} subordinates`);
      });
    }
  });
  console.log('');

  // 5. Test Dynamic Employee Creation & Instant Hierarchy Inclusion
  console.log('Step 5: Testing Add Employee under Manager Asif...');
  // Find Asif's user ID
  const asifUser = hierData.hierarchy.children.find((c) => c.name.toLowerCase().includes('asif'));
  assert.ok(asifUser, 'Manager Asif should exist in hierarchy');

  const newEmpPayload = {
    name: 'Rohit Sharma',
    email: 'rohit.sharma@testenterprise.com',
    username: 'rohitsharma',
    password: 'user123',
    role: 'User',
    department: 'Backend Work',
    reportsTo: asifUser._id,
    reportsToName: `${asifUser.name} (${asifUser.role})`,
  };

  const createEmpRes = await fetch(`${baseUrl}/users`, {
    method: 'POST',
    headers: superAdminHeaders,
    body: JSON.stringify(newEmpPayload),
  });
  const createEmpData = await createEmpRes.json();
  assert.strictEqual(createEmpRes.status, 201);
  assert.strictEqual(createEmpData.success, true);
  const createdEmpId = createEmpData.user._id;
  console.log(`✓ Added Employee: ${createEmpData.user.name} (Reports To: ${createEmpData.user.reportsToName})\n`);

  // Verify updated hierarchy tree reflects Rohit Sharma under Asif
  console.log('Step 6: Verifying dynamic hierarchy reflection after adding employee...');
  const updatedHierRes = await fetch(`${baseUrl}/hierarchy`, { headers: superAdminHeaders });
  const updatedHierData = await updatedHierRes.json();
  const updatedAsifBranch = updatedHierData.hierarchy.children.find((c) => c._id.toString() === asifUser._id.toString());
  const rohitInTree = updatedAsifBranch.children.find((c) => c._id.toString() === createdEmpId.toString());
  assert.ok(rohitInTree, 'Rohit Sharma must now be dynamically present under Asif in the hierarchy tree');
  assert.strictEqual(rohitInTree.name, 'Rohit Sharma');
  assert.ok(rohitInTree.reportingChain.length >= 2, 'Reporting chain must connect up to Super Admin');
  console.log(`✓ Verified: Rohit Sharma is dynamically present under Asif!`);
  console.log(`✓ Rohit's Full Reporting Chain: ${rohitInTree.reportingChain.map((m) => m.name).join(' → ')}\n`);

  // 7. Test Reporting Manager Reassignment
  console.log('Step 7: Testing Reporting Reassignment (Move Rohit from Asif to Wasil)...');
  // Find Wasil
  const shoaibBranch = updatedHierData.hierarchy.children.find((c) => c.name.toLowerCase().includes('shoaib'));
  const wasilNode = shoaibBranch?.children?.find((c) => c.name.toLowerCase().includes('wasil'));
  assert.ok(wasilNode, 'Wasil node must exist in Shoaib branch');

  const reassignRes = await fetch(`${baseUrl}/users/${createdEmpId}`, {
    method: 'PUT',
    headers: superAdminHeaders,
    body: JSON.stringify({
      reportsTo: wasilNode._id,
      reportsToName: `${wasilNode.name} (${wasilNode.role})`,
    }),
  });
  const reassignData = await reassignRes.json();
  assert.strictEqual(reassignRes.status, 200);
  assert.strictEqual(reassignData.success, true);
  console.log(`✓ Reassigned Rohit's reporting manager to Wasil\n`);

  // Verify hierarchy updated again with new reporting branch
  console.log('Step 8: Verifying hierarchy tree reflects branch move...');
  const movedHierRes = await fetch(`${baseUrl}/hierarchy`, { headers: superAdminHeaders });
  const movedHierData = await movedHierRes.json();
  const updatedShoaib = movedHierData.hierarchy.children.find((c) => c._id.toString() === shoaibBranch._id.toString());
  const updatedWasil = updatedShoaib.children.find((c) => c._id.toString() === wasilNode._id.toString());
  const rohitUnderWasil = updatedWasil.children.find((c) => c._id.toString() === createdEmpId.toString());
  assert.ok(rohitUnderWasil, 'Rohit Sharma must now be dynamically nested under Wasil in the hierarchy tree');
  console.log(`✓ Verified: Rohit Sharma now dynamically appears under Wasil!`);
  console.log(`✓ New Multi-Level Reporting Chain: ${rohitUnderWasil.reportingChain.map((m) => m.name).join(' → ')}\n`);

  // 8. Clean up created test employee
  console.log('Step 9: Cleaning up test employee...');
  const delEmpRes = await fetch(`${baseUrl}/users/${createdEmpId}`, {
    method: 'DELETE',
    headers: superAdminHeaders,
  });
  assert.strictEqual(delEmpRes.status, 200);
  console.log(`✓ Test employee removed cleanly\n`);

  // 9. Test Task Management Full CRUD
  console.log('Step 10: Testing Task Creation & Assignment...');
  const taskPayload = {
    taskType: 'backend work',
    description: 'Deploy GraphQL federated gateway across distributed microservices',
    expectedDate: new Date('2026-09-30T18:00:00Z'),
    remark: 'Ensure JWT auth context passes through to downstream microservices',
    status: 'To Do',
    assignedTo: 'Asif',
  };
  const createTaskRes = await fetch(`${baseUrl}/tasks`, {
    method: 'POST',
    headers: superAdminHeaders,
    body: JSON.stringify(taskPayload),
  });
  const createTaskData = await createTaskRes.json();
  assert.strictEqual(createTaskRes.status, 201);
  assert.strictEqual(createTaskData.success, true);
  const createdTaskId = createTaskData.task._id;
  console.log(`✓ Task created with ID: ${createdTaskId}`);

  // Test Task Status Update: To Do -> In Progress -> Completed
  console.log('\nStep 11: Testing Task Status Transitions...');
  const patchStatusRes = await fetch(`${baseUrl}/tasks/${createdTaskId}/status`, {
    method: 'PATCH',
    headers: managerHeaders,
    body: JSON.stringify({ status: 'In Progress' }),
  });
  const patchStatusData = await patchStatusRes.json();
  assert.strictEqual(patchStatusRes.status, 200);
  assert.strictEqual(patchStatusData.task.status, 'In Progress');
  console.log(`✓ Status transitioned to "In Progress"`);

  const completeStatusRes = await fetch(`${baseUrl}/tasks/${createdTaskId}/status`, {
    method: 'PATCH',
    headers: managerHeaders,
    body: JSON.stringify({ status: 'Completed', completionRemark: 'Deployed and validated with smoke tests' }),
  });
  const completeStatusData = await completeStatusRes.json();
  assert.strictEqual(completeStatusRes.status, 200);
  assert.strictEqual(completeStatusData.task.status, 'Completed');
  console.log(`✓ Status transitioned to "Completed"`);

  // Clean up test task
  const delTaskRes = await fetch(`${baseUrl}/tasks/${createdTaskId}`, {
    method: 'DELETE',
    headers: superAdminHeaders,
  });
  assert.strictEqual(delTaskRes.status, 200);
  console.log(`✓ Test task removed cleanly\n`);

  console.log('=================================================================');
  console.log('🎉 ALL SYSTEM & HIERARCHY VERIFICATION TESTS PASSED WITH 100% SUCCESS!');
  console.log('=================================================================');
}

runSystemVerification().catch((err) => {
  console.error('\n❌ Verification Failed:', err);
  process.exit(1);
});
