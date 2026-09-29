const http = require('http');

const baseUrl = 'http://localhost:5000/api';

const request = (method, path, body = null, token = null) => {
  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}${path}`);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
};

async function runTests() {
  console.log('=== TaskFlow Lead Management & Lead to Opportunity Automated Test Suite ===\n');

  try {
    // 1. Authenticate as Super Admin
    console.log('1. Logging in as Super Admin (sarfraj)...');
    const loginRes = await request('POST', '/auth/login', {
      usernameOrEmail: 'sarfraj',
      password: 'user123',
    });

    if (loginRes.status !== 200 || !loginRes.data.token) {
      throw new Error(`Login failed: ${JSON.stringify(loginRes.data)}`);
    }
    const token = loginRes.data.token;
    console.log('✅ Login successful. Token acquired.\n');

    // 2. Fetch Lead MIS Stats
    console.log('2. Testing GET /api/leads/stats...');
    const statsRes = await request('GET', '/leads/stats', null, token);
    console.log('Status:', statsRes.status);
    console.log('Stats:', {
      totalLeads: statsRes.data.stats?.totalLeads,
      qualified: statsRes.data.stats?.qualifiedLeads,
      converted: statsRes.data.stats?.convertedLeads,
      conversionRate: `${statsRes.data.stats?.conversionRate}%`,
      callAttempts: statsRes.data.stats?.totalCallAttempts,
    });
    if (statsRes.status !== 200) throw new Error('Stats retrieval failed');
    console.log('✅ MIS Stats API verified.\n');

    // 3. Create a New Lead
    console.log('3. Testing POST /api/leads (Creating Lead for Acme Apex Corp)...');
    const newLeadRes = await request(
      'POST',
      '/leads',
      {
        contactPerson: 'Vikram Malhotra',
        company: 'Acme Apex Corp',
        mobileNumber: '+91 99887 76655',
        email: `vikram_${Date.now()}@acmeapex.com`,
        source: 'Website',
        requirement: 'Enterprise Lead Management with 25 Sales Reps and SLA Escalation',
        status: 'New',
        priority: 'High',
        estimatedValue: 650000,
        assignedSalesUser: 'Sarfaraj Ahmad',
        remarks: 'Direct inquiry from website pricing page.',
        nextFollowUpDate: '2026-09-27',
        nextFollowUpTime: '10:00 AM',
      },
      token
    );

    console.log('Status:', newLeadRes.status, 'Body:', newLeadRes.data);
    const createdLead = newLeadRes.data.lead;
    if (newLeadRes.status !== 201 || !createdLead || !createdLead.leadId) throw new Error(`Lead creation failed: ${JSON.stringify(newLeadRes.data)}`);
    console.log(`Created Lead ID: ${createdLead.leadId} (_id: ${createdLead._id}), Status: ${createdLead.status}`);
    console.log('✅ Lead creation verified.\n');

    const leadId = createdLead._id;

    // 4. Test Attempt 1: Call Attempt - No Answer
    console.log('4. Testing POST /api/leads/:id/calls (Attempt 1: No Answer)...');
    const call1Res = await request(
      'POST',
      `/leads/${leadId}/calls`,
      {
        salesUser: 'Sarfaraj Ahmad',
        callType: 'Outgoing',
        date: '2026-09-26',
        time: '10:00 AM',
        callStatus: 'No Answer',
        callOutcome: 'No Response',
        remarks: 'First contact attempt after inquiry.',
        nextAction: 'Call Again',
        nextFollowUpDate: '2026-09-26',
        nextFollowUpTime: '11:30 AM',
      },
      token
    );
    console.log('Status:', call1Res.status);
    console.log('Call 1 Activity ID:', call1Res.data.callLog?.activityId);
    if (call1Res.status !== 201) throw new Error('Call 1 logging failed');
    console.log('✅ Attempt 1 recorded.\n');

    // 5. Test Attempt 2: Callback Requested (Quote from user prompt)
    console.log('5. Testing POST /api/leads/:id/calls (Attempt 2: Callback Requested with Quote)...');
    const call2Res = await request(
      'POST',
      `/leads/${leadId}/calls`,
      {
        salesUser: 'Sarfaraj Ahmad',
        callType: 'Outgoing',
        date: '2026-09-26',
        time: '11:30 AM',
        callStatus: 'Call Received',
        duration: '1m 10s',
        callOutcome: 'Call Later',
        leadResponse: 'Abhi busy hoon, 4 ghante baad call kijiye.',
        remarks: 'Client in executive meeting, requested callback at 3:30 PM.',
        nextAction: 'Call Back',
        nextFollowUpDate: '2026-09-26',
        nextFollowUpTime: '03:30 PM',
      },
      token
    );
    console.log('Status:', call2Res.status);
    console.log('Call 2 Activity ID:', call2Res.data.callLog?.activityId);
    if (call2Res.status !== 201) throw new Error('Call 2 logging failed');
    console.log('✅ Attempt 2 recorded.\n');

    // 6. Test Attempt 3: Connected Successfully & Interested
    console.log('6. Testing POST /api/leads/:id/calls (Attempt 3: Connected Successfully & Interested)...');
    const call3Res = await request(
      'POST',
      `/leads/${leadId}/calls`,
      {
        salesUser: 'Sarfaraj Ahmad',
        callType: 'Outgoing',
        date: '2026-09-26',
        time: '03:30 PM',
        callStatus: 'Connected Successfully',
        duration: '5m 45s',
        callOutcome: 'Interested',
        leadResponse: 'Product demo looks great, please share enterprise commercial quote.',
        remarks: 'Lead is interested in the product and wants pricing details.',
        nextAction: 'Send Proposal',
        updateStatus: 'Interested',
      },
      token
    );
    console.log('Status:', call3Res.status);
    console.log('Call 3 Activity ID:', call3Res.data.callLog?.activityId);
    console.log('Updated Lead Status:', call3Res.data.lead?.status);
    if (call3Res.status !== 201 || call3Res.data.lead?.status !== 'Interested') {
      throw new Error('Call 3 logging or status transition failed');
    }
    console.log('✅ Attempt 3 recorded and lead status transitioned to "Interested".\n');

    // 7. Verify GET /api/leads/:id/calls
    console.log('7. Testing GET /api/leads/:id/calls...');
    const callsListRes = await request('GET', `/leads/${leadId}/calls`, null, token);
    console.log(`Preserved Call Logs Count: ${callsListRes.data.count}`);
    if (callsListRes.data.count < 3) throw new Error('Call logs were not preserved chronologically');
    console.log('✅ Call history preservation verified.\n');

    // 8. Test Schedule Follow-Up & Update
    console.log('8. Testing POST /api/leads/:id/followups and PUT /api/followups/:id...');
    const flwRes = await request(
      'POST',
      `/leads/${leadId}/followups`,
      {
        followUpDate: '2026-09-27',
        followUpTime: '02:00 PM',
        reason: 'Commercial proposal walkthrough with VP',
        assignedTo: 'Sarfaraj Ahmad',
        remarks: 'Prepare customized 25-seat pricing sheet',
        status: 'Pending',
      },
      token
    );
    const createdFlw = flwRes.data.followup;
    console.log(`Created Follow-up ID: ${createdFlw.followUpId}, Status: ${createdFlw.status}`);

    const updateFlwRes = await request(
      'PUT',
      `/followups/${createdFlw.followUpId}`,
      {
        status: 'Completed',
        remarks: 'Proposal sent and reviewed with Vikram.',
      },
      token
    );
    console.log(`Updated Follow-up Status: ${updateFlwRes.data.followup?.status}`);
    if (updateFlwRes.data.followup?.status !== 'Completed') throw new Error('Follow-up update failed');
    console.log('✅ Follow-up scheduling and status completion verified.\n');

    // 9. Test Conversion Validation: Disallow when not Qualified or Interested
    console.log('9. Testing Conversion Backend Validation (Rejecting ineligible status)...');
    // Create a temporary New lead to test conversion rejection
    const unqualLeadRes = await request(
      'POST',
      '/leads',
      {
        contactPerson: 'Unqualified Test Lead',
        company: 'Test Unqual Ltd',
        status: 'New',
      },
      token
    );
    const unqualId = unqualLeadRes.data.lead._id;

    const invalidConvRes = await request(
      'POST',
      `/leads/${unqualId}/convert`,
      {
        opportunityName: 'Premature Deal',
      },
      token
    );
    console.log('Ineligible conversion attempt status:', invalidConvRes.status);
    console.log('Rejection message:', invalidConvRes.data.message);
    if (invalidConvRes.status !== 400) throw new Error('Backend did not reject conversion of un-qualified lead');
    console.log('✅ Ineligible conversion correctly rejected by backend.\n');

    // 10. Test Valid Conversion of Interested Lead to Opportunity
    console.log('10. Testing POST /api/leads/:id/convert (Converting Interested lead to Opportunity)...');
    const convertRes = await request(
      'POST',
      `/leads/${leadId}/convert`,
      {
        opportunityName: 'Acme Apex Corp - 25 Seat Enterprise Rollout',
        dealValue: 650000,
        expectedCloseDate: '2026-10-26',
        stage: 'Qualification',
        assignedTo: 'Sarfaraj Ahmad',
        remarks: 'Commercial negotiations ongoing.',
      },
      token
    );
    console.log('Status:', convertRes.status);
    const convertedOpp = convertRes.data.opportunity;
    const updatedLead = convertRes.data.lead;
    console.log(`Generated Opportunity ID: ${convertedOpp.opportunityId} (${convertedOpp.name})`);
    console.log(`Lead Status: ${updatedLead.status}, Associated Opportunity ID in Lead: ${updatedLead.opportunityId}`);
    if (convertRes.status !== 201 || updatedLead.status !== 'Converted' || !convertedOpp.opportunityId) {
      throw new Error('Lead conversion failed');
    }
    console.log('✅ Lead to Opportunity conversion successful.\n');

    // 11. Test Duplicate Conversion Prevention (Item 9)
    console.log('11. Testing Duplicate Conversion Prevention (POST /api/leads/:id/convert on already converted lead)...');
    const duplicateConvRes = await request(
      'POST',
      `/leads/${leadId}/convert`,
      {
        opportunityName: 'Duplicate Attempt',
      },
      token
    );
    console.log('Duplicate conversion attempt status:', duplicateConvRes.status);
    console.log('Rejection message:', duplicateConvRes.data.message);
    if (duplicateConvRes.status !== 400) {
      throw new Error('Duplicate conversion was not prevented by the backend!');
    }
    console.log('✅ Duplicate conversion strictly prevented by backend.\n');

    // 12. Verify Lead Details & Timeline Journey
    console.log('12. Testing GET /api/leads/:id (Checking complete journey and timeline)...');
    const finalLeadRes = await request('GET', `/leads/${leadId}`, null, token);
    const finalLead = finalLeadRes.data.lead;
    console.log(`Lead: ${finalLead.leadId} - ${finalLead.name}`);
    console.log(`Total Call Logs preserved: ${finalLead.callLogs?.length}`);
    console.log(`Total Follow-ups preserved: ${finalLead.followups?.length}`);
    console.log(`Total Timeline Events: ${finalLead.timeline?.length}`);
    console.log('Timeline Journey Steps:');
    finalLead.timeline.forEach((evt, i) => {
      console.log(`  ${i + 1}. [${evt.eventType}] ${evt.title} — ${evt.description}`);
    });
    console.log('✅ Complete traceable journey verified.\n');

    console.log('================================================================');
    console.log('🎉 ALL 12 WORKFLOW VALIDATION TESTS PASSED SUCCESSFULLY! 🎉');
    console.log('================================================================');
  } catch (err) {
    console.error('❌ Test suite failed:', err);
    process.exit(1);
  }
}

runTests();
