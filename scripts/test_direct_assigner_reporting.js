const assert = require('assert');

async function testDirectAssignerReporting() {
  console.log('=================================================================');
  console.log('🧪 TESTING DIRECT ASSIGNER REPORTING & RISHU UNDER HARSH');
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
  assert.strictEqual(superData.success, true);
  const superHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${superData.token}`,
  };

  // 2. Verify Rishu is under Harsh
  console.log('\nStep 2: Verifying Rishu is under Harsh in hierarchy...');
  const usersRes = await fetch(`${baseUrl}/users`, { headers: superHeaders });
  const usersData = await usersRes.json();
  
  const harsh = usersData.users.find(u => (u.name || '').toLowerCase() === 'harsh' || u.username === 'harsh');
  const rishu = usersData.users.find(u => (u.name || '').toLowerCase() === 'rishu' || u.username === 'rishu');

  assert.ok(harsh, 'Harsh must exist');
  assert.ok(rishu, 'Rishu must exist');

  // Ensure Rishu reportsTo is Harsh
  if (rishu.reportsTo !== harsh._id.toString()) {
    console.log(`Setting Rishu reportsTo to Harsh (${harsh._id})...`);
    await fetch(`${baseUrl}/users/${rishu._id}`, {
      method: 'PUT',
      headers: superHeaders,
      body: JSON.stringify({
        reportsTo: harsh._id,
        reportsToName: `${harsh.name} (${harsh.role || 'User'})`,
      }),
    });
  }

  const updatedRishuRes = await fetch(`${baseUrl}/users?search=rishu`, { headers: superHeaders });
  const updatedRishuData = await updatedRishuRes.json();
  const confirmedRishu = updatedRishuData.users.find(u => (u.name || '').toLowerCase() === 'rishu');
  console.log(`✓ Rishu is configured to report to: ${confirmedRishu.reportsToName} (ID: ${confirmedRishu.reportsTo})`);
  assert.strictEqual(confirmedRishu.reportsTo, harsh._id.toString(), 'Rishu MUST report directly to Harsh');

  // 3. Authenticate as Harsh
  console.log('\nStep 3: Authenticating as Harsh (User)...');
  const harshLoginRes = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      usernameOrEmail: harsh.email || harsh.username,
      password: 'user123',
    }),
  });
  const harshLoginData = await harshLoginRes.json();
  assert.strictEqual(harshLoginData.success, true);
  const harshHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${harshLoginData.token}`,
  };
  console.log(`✓ Logged in as Harsh: ${harsh.name}`);

  // 4. Authenticate as Rishu
  console.log('\nStep 4: Authenticating as Rishu (User)...');
  const rishuLoginRes = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      usernameOrEmail: rishu.email || rishu.username,
      password: 'user123',
    }),
  });
  const rishuLoginData = await rishuLoginRes.json();
  assert.strictEqual(rishuLoginData.success, true);
  const rishuHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${rishuLoginData.token}`,
  };
  console.log(`✓ Logged in as Rishu: ${rishu.name}`);

  // 5. Harsh assigns a task to Rishu
  console.log('\nStep 5: Harsh assigns a task to Rishu...');
  const assignTaskRes = await fetch(`${baseUrl}/tasks`, {
    method: 'POST',
    headers: harshHeaders,
    body: JSON.stringify({
      taskType: 'social media',
      description: 'Create promotional graphic banners for Twitter campaign',
      expectedDate: new Date(Date.now() + 86400000 * 3).toISOString(),
      remark: 'Follow brand guidelines strictly',
      assignedTo: rishu.name,
      status: 'To Do',
    }),
  });
  const assignTaskData = await assignTaskRes.json();
  assert.strictEqual(assignTaskRes.status, 201, 'Harsh must be able to assign task to Rishu');
  assert.strictEqual(assignTaskData.success, true);
  const taskId = assignTaskData.task._id;
  console.log(`✓ Task created: ${assignTaskData.task.description}`);
  console.log(`  Assigned To: ${assignTaskData.task.assignedTo}`);
  console.log(`  Assigned By: ${assignTaskData.task.assignedBy}`);

  // 6. Rishu checks his notifications (should receive assignment notification from Harsh)
  console.log('\nStep 6: Rishu fetches notifications...');
  const rishuNotifsRes = await fetch(`${baseUrl}/notifications`, { headers: rishuHeaders });
  const rishuNotifsData = await rishuNotifsRes.json();
  assert.strictEqual(rishuNotifsRes.status, 200);
  const assignNotif = rishuNotifsData.notifications.find(n => n.taskId === taskId || n.type === 'task_assigned');
  assert.ok(assignNotif, 'Rishu must receive assignment notification');
  console.log(`✓ Rishu received assignment notification: "${assignNotif.title}" - Assigned by: ${assignNotif.assignedBy}`);

  // 7. Rishu completes the task and reports directly to Harsh
  console.log('\nStep 7: Rishu completes task with completion remark directly for Harsh...');
  const completeRes = await fetch(`${baseUrl}/tasks/${taskId}`, {
    method: 'PUT',
    headers: rishuHeaders,
    body: JSON.stringify({
      status: 'Completed',
      completionRemark: 'All Twitter campaign banners have been exported and uploaded to Drive folder.',
    }),
  });
  const completeData = await completeRes.json();
  assert.strictEqual(completeRes.status, 200);
  assert.strictEqual(completeData.task.status, 'Completed');
  console.log(`✓ Task completed by Rishu! Status: ${completeData.task.status}`);

  // 8. Harsh checks notifications (Harsh MUST receive the completion report from Rishu!)
  console.log('\nStep 8: Harsh checks his notifications to verify direct reporting...');
  const harshNotifsRes = await fetch(`${baseUrl}/notifications`, { headers: harshHeaders });
  const harshNotifsData = await harshNotifsRes.json();
  assert.strictEqual(harshNotifsRes.status, 200);

  const completionNotif = harshNotifsData.notifications.find(
    n => n.type === 'task_completed' && (n.userName === 'rishu' || (n.message && n.message.includes('rishu')))
  );

  assert.ok(completionNotif, 'Harsh (assigner) MUST receive the completion report directly from Rishu!');
  console.log(`✅ Direct Reporting Verified: Harsh received completion notification from Rishu:`);
  console.log(`   Title: ${completionNotif.title}`);
  console.log(`   Message: ${completionNotif.message}`);
  console.log(`   Remark: ${completionNotif.remark}`);
  console.log(`   Recipient: ${completionNotif.recipientName}`);

  console.log('\n=================================================================');
  console.log('🎉 DIRECT ASSIGNER REPORTING & RISHU-UNDER-HARSH VERIFIED 100%!');
  console.log('=================================================================\n');
}

testDirectAssignerReporting().catch((err) => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
