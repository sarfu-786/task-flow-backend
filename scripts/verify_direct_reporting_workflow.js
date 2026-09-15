const BASE_URL = 'http://localhost:5000/api';

async function req(url, options = {}) {
  const res = await fetch(`${BASE_URL}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`[${res.status}] ${data.message || JSON.stringify(data)}`);
  }
  return data;
}

async function runVerification() {
  console.log('=== Starting Complete End-to-End Hierarchy & Direct Assigner Reporting Test ===\n');

  try {
    // 1. Login as all relevant users: asdf, Asif, Harsh, rishu, rajesh, Vivek
    console.log('1. Logging in users...');
    const login = async (username, password) => {
      const data = await req('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      return { token: data.token, user: data.user };
    };

    const asdfAuth = await login('aaaa', '123456'); // asdf
    console.log(`- asdf logged in: ${asdfAuth.user.name} (${asdfAuth.user.role}) ID: ${asdfAuth.user._id}`);

    const asifAuth = await login('asif', '123456'); // Asif (Manager)
    console.log(`- Asif logged in: ${asifAuth.user.name} (${asifAuth.user.role}) ID: ${asifAuth.user._id}`);

    const harshAuth = await login('harsh', '123456'); // Harsh (User)
    console.log(`- Harsh logged in: ${harshAuth.user.name} (${harshAuth.user.role}) ID: ${harshAuth.user._id}`);

    const rishuAuth = await login('rishu', '123456'); // rishu (User)
    console.log(`- rishu logged in: ${rishuAuth.user.name} (${rishuAuth.user.role}) ID: ${rishuAuth.user._id}`);

    const rajeshAuth = await login('rajesh', '123456'); // rajesh (User)
    console.log(`- rajesh logged in: ${rajeshAuth.user.name} (${rajeshAuth.user.role}) ID: ${rajeshAuth.user._id}`);

    const vvkAuth = await login('vvk', '123456'); // Vivek (User)
    console.log(`- Vivek logged in: ${vvkAuth.user.name} (${vvkAuth.user.role}) ID: ${vvkAuth.user._id}`);

    const authHeaders = (token) => ({ headers: { Authorization: `Bearer ${token}` } });

    // 2. Test asdf assigning tasks to all 4 subordinates under him: rajesh, Harsh, Vivek, rishu
    console.log('\n2. Testing asdf assigning tasks to all subordinates (rajesh, Harsh, Vivek, rishu)...');
    const subordinates = ['rajesh', 'Harsh', 'Vivek', 'rishu'];
    const createdTasksByAsdf = [];

    for (const sub of subordinates) {
      const res = await req('/tasks', {
        method: 'POST',
        body: JSON.stringify({
          taskType: 'documentation',
          description: `Task assigned by asdf to ${sub}`,
          expectedDate: new Date(Date.now() + 86400000 * 3).toISOString(),
          assignedTo: sub,
        }),
        ...authHeaders(asdfAuth.token),
      });

      if (res.success) {
        console.log(`  ✓ asdf successfully assigned task to ${sub} (Task ID: ${res.task._id})`);
        createdTasksByAsdf.push(res.task);
      } else {
        throw new Error(`Failed to assign task to ${sub}: ${res.message}`);
      }
    }

    // 3. Test Direct Reporting: Rishu completes task assigned by asdf
    console.log('\n3. Testing Direct Reporting: rishu completes task assigned by asdf...');
    const rishuTaskFromAsdf = createdTasksByAsdf.find((t) => t.assignedTo.toLowerCase() === 'rishu');

    const completeRes = await req(`/tasks/${rishuTaskFromAsdf._id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'Completed',
        completionRemark: 'Completed work assigned by asdf. Verification done.',
      }),
      ...authHeaders(rishuAuth.token),
    });

    console.log(`  ✓ rishu marked task as Completed with remark: "${completeRes.task.completionRemark}"`);

    // 4. Verify who received the task_completed notification
    console.log('\n4. Verifying notification routing (Must ONLY be in asdf inbox!)...');

    // Check asdf inbox
    const asdfNotifs = await req('/notifications', authHeaders(asdfAuth.token));
    const asdfHasCompletionNotif = asdfNotifs.notifications.some(
      (n) => n.type === 'task_completed' && n.taskId === rishuTaskFromAsdf._id
    );
    console.log(`  -> asdf inbox has completion notification: ${asdfHasCompletionNotif ? 'YES (CORRECT ✓)' : 'NO (FAIL ✗)'}`);

    // Check Asif (Manager) inbox - should NOT have it
    const asifNotifs = await req('/notifications', authHeaders(asifAuth.token));
    const asifHasCompletionNotif = asifNotifs.notifications.some(
      (n) => n.type === 'task_completed' && n.taskId === rishuTaskFromAsdf._id
    );
    console.log(`  -> Asif (Manager) inbox has completion notification: ${asifHasCompletionNotif ? 'YES (UNEXPECTED ✗)' : 'NO (CORRECT ✓)'}`);

    // Check Harsh inbox - should NOT have it
    const harshNotifs = await req('/notifications', authHeaders(harshAuth.token));
    const harshHasCompletionNotif = harshNotifs.notifications.some(
      (n) => n.type === 'task_completed' && n.taskId === rishuTaskFromAsdf._id
    );
    console.log(`  -> Harsh inbox has completion notification: ${harshHasCompletionNotif ? 'YES (UNEXPECTED ✗)' : 'NO (CORRECT ✓)'}`);

    // Check rajesh inbox - should NOT have it
    const rajeshNotifs = await req('/notifications', authHeaders(rajeshAuth.token));
    const rajeshHasCompletionNotif = rajeshNotifs.notifications.some(
      (n) => n.type === 'task_completed' && n.taskId === rishuTaskFromAsdf._id
    );
    console.log(`  -> rajesh inbox has completion notification: ${rajeshHasCompletionNotif ? 'YES (UNEXPECTED ✗)' : 'NO (CORRECT ✓)'}`);

    if (!asdfHasCompletionNotif || asifHasCompletionNotif || harshHasCompletionNotif || rajeshHasCompletionNotif) {
      throw new Error('Direct assigner notification isolation failed for asdf task assignment!');
    }

    // 5. Test Manager (Asif) assigning task to lowest user rishu
    console.log('\n5. Testing Manager (Asif) assigning task to rishu and reporting directly to Asif...');
    const asifTaskRes = await req('/tasks', {
      method: 'POST',
      body: JSON.stringify({
        taskType: 'internet work',
        description: 'Asif Manager assigned research task to rishu',
        expectedDate: new Date(Date.now() + 86400000 * 2).toISOString(),
        assignedTo: 'rishu',
      }),
      ...authHeaders(asifAuth.token),
    });
    console.log(`  ✓ Asif assigned task to rishu (Task ID: ${asifTaskRes.task._id})`);

    // Rishu completes Asif's task
    await req(`/tasks/${asifTaskRes.task._id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'Completed',
        completionRemark: 'Completed research for Asif Manager directly.',
      }),
      ...authHeaders(rishuAuth.token),
    });
    console.log('  ✓ rishu marked Asif task as Completed');

    // Verify Asif gets completion notif and asdf / Harsh do NOT
    const asifNotifs2 = await req('/notifications', authHeaders(asifAuth.token));
    const asifHasCompletionNotif2 = asifNotifs2.notifications.some(
      (n) => n.type === 'task_completed' && n.taskId === asifTaskRes.task._id
    );
    console.log(`  -> Asif (Manager) received direct completion notification: ${asifHasCompletionNotif2 ? 'YES (CORRECT ✓)' : 'NO (FAIL ✗)'}`);

    const asdfNotifs2 = await req('/notifications', authHeaders(asdfAuth.token));
    const asdfHasCompletionNotif2 = asdfNotifs2.notifications.some(
      (n) => n.type === 'task_completed' && n.taskId === asifTaskRes.task._id
    );
    console.log(`  -> asdf received Asif completion notification: ${asdfHasCompletionNotif2 ? 'YES (UNEXPECTED ✗)' : 'NO (CORRECT ✓)'}`);

    if (!asifHasCompletionNotif2 || asdfHasCompletionNotif2) {
      throw new Error('Direct assigner notification isolation failed for Asif Manager assignment!');
    }

    // 6. Test Harsh assigning task to rishu and reporting directly to Harsh
    console.log('\n6. Testing Harsh assigning task to rishu and reporting directly to Harsh...');
    const harshTaskRes = await req('/tasks', {
      method: 'POST',
      body: JSON.stringify({
        taskType: 'social media',
        description: 'Harsh assigned media graphics to rishu',
        expectedDate: new Date(Date.now() + 86400000 * 2).toISOString(),
        assignedTo: 'rishu',
      }),
      ...authHeaders(harshAuth.token),
    });
    console.log(`  ✓ Harsh assigned task to rishu (Task ID: ${harshTaskRes.task._id})`);

    // Rishu completes Harsh's task
    await req(`/tasks/${harshTaskRes.task._id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'Completed',
        completionRemark: 'Completed media graphics for Harsh directly.',
      }),
      ...authHeaders(rishuAuth.token),
    });
    console.log('  ✓ rishu marked Harsh task as Completed');

    const harshNotifs2 = await req('/notifications', authHeaders(harshAuth.token));
    const harshHasCompletionNotif2 = harshNotifs2.notifications.some(
      (n) => n.type === 'task_completed' && n.taskId === harshTaskRes.task._id
    );
    console.log(`  -> Harsh received direct completion notification: ${harshHasCompletionNotif2 ? 'YES (CORRECT ✓)' : 'NO (FAIL ✗)'}`);

    const asifNotifs3 = await req('/notifications', authHeaders(asifAuth.token));
    const asifHasCompletionNotif3 = asifNotifs3.notifications.some(
      (n) => n.type === 'task_completed' && n.taskId === harshTaskRes.task._id
    );
    console.log(`  -> Asif (Manager) received Harsh task completion notification: ${asifHasCompletionNotif3 ? 'YES (UNEXPECTED ✗)' : 'NO (CORRECT ✓)'}`);

    if (!harshHasCompletionNotif2 || asifHasCompletionNotif3) {
      throw new Error('Direct assigner notification isolation failed for Harsh assignment!');
    }

    console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY! Direct Assigner Reporting & Multi-Level Hierarchy are 100% verified.');
  } catch (err) {
    console.error('\n❌ Verification Failed:', err.message);
    process.exit(1);
  }
}

runVerification();
