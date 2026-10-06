const User = require('../models/User');
const { fallbackStore } = require('../config/db');

// Safe regex character escaper
const escapeRegex = (str) => (str ? str.toString().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '');

/**
 * Fetch all users from DB or fallbackStore
 */
const getAllUsers = async () => {
  if (fallbackStore.isFallback) {
    return fallbackStore.users || [];
  }
  return await User.find({}).select('_id name username email role roles department reportsTo reportsToName createdBy status').lean();
};

/**
 * Helper to get all user IDs that are direct or recursive indirect subordinates of the user in the hierarchy
 */
const getSubordinateUserIds = (user, allUsers) => {
  if (!user || !allUsers || !Array.isArray(allUsers)) return new Set();
  const userId = (user._id ? user._id.toString() : (user.id ? user.id.toString() : '')).trim();
  const userName = (user.name || '').toLowerCase().trim();
  const userUsername = (user.username || '').toLowerCase().trim();

  const subordinateIds = new Set();
  if (!userId && !userName) return subordinateIds;

  const queue = [userId];
  const processed = new Set([userId]);

  while (queue.length > 0) {
    const currentParentId = queue.shift();
    const parentUser = allUsers.find((u) => u && u._id && u._id.toString() === currentParentId);
    const parentName = (parentUser?.name || (currentParentId === userId ? userName : '')).toLowerCase().trim();
    const parentUsername = (parentUser?.username || (currentParentId === userId ? userUsername : '')).toLowerCase().trim();

    for (const u of allUsers) {
      if (!u || !u._id) continue;
      const uIdStr = u._id.toString();
      if (uIdStr === userId || processed.has(uIdStr)) continue;

      const repIdStr = u.reportsTo ? (u.reportsTo._id ? u.reportsTo._id.toString() : u.reportsTo.toString()) : '';
      const repNameStr = (u.reportsToName || '').toLowerCase().trim();
      const cleanRepName = repNameStr.replace(/\s*\([^)]*\)/g, '').trim();
      const createdByStr = u.createdBy ? (u.createdBy._id ? u.createdBy._id.toString() : u.createdBy.toString()) : '';

      const isDirectReport =
        (currentParentId && repIdStr === currentParentId) ||
        (parentName && cleanRepName && cleanRepName === parentName) ||
        (parentName && repNameStr && repNameStr.includes(parentName)) ||
        (parentUsername && cleanRepName && cleanRepName === parentUsername);

      const isCreatedByParent = currentParentId && createdByStr === currentParentId;

      if (isDirectReport || isCreatedByParent) {
        subordinateIds.add(uIdStr);
        processed.add(uIdStr);
        queue.push(uIdStr);
      }
    }
  }

  return subordinateIds;
};

/**
 * Returns complete access scope context for a user (Self + Subordinates)
 */
const getUserScopeContext = (user, allUsers = []) => {
  if (!user) {
    return {
      isSuperAdmin: false,
      currentUserId: '',
      currentUserName: '',
      currentUserUsername: '',
      currentUserEmail: '',
      allowedUserIds: new Set(),
      allowedNames: new Set(),
      subordinateIds: [],
      subordinateUsers: [],
    };
  }

  const userRoles = Array.isArray(user.roles) && user.roles.length > 0 ? user.roles : [user.role || 'User'];
  const isSuperAdmin = userRoles.some(r => r === 'Super Admin' || r === 'superadmin') || user.role === 'Super Admin';

  const currentUserId = (user._id ? user._id.toString() : (user.id ? user.id.toString() : '')).trim();
  const currentUserName = (user.name || '').toLowerCase().trim();
  const currentUserUsername = (user.username || '').toLowerCase().trim();
  const currentUserEmail = (user.email || '').toLowerCase().trim();

  if (isSuperAdmin) {
    return {
      isSuperAdmin: true,
      currentUserId,
      currentUserName,
      currentUserUsername,
      currentUserEmail,
      allowedUserIds: null, // null means all
      allowedNames: null,
      subordinateIds: allUsers.map((u) => (u._id ? u._id.toString() : '')).filter((id) => id && id !== currentUserId),
      subordinateUsers: allUsers.filter((u) => u._id && u._id.toString() !== currentUserId),
    };
  }

  const subordinateIdsSet = getSubordinateUserIds(user, allUsers);
  const subordinateUsers = allUsers.filter((u) => u && u._id && subordinateIdsSet.has(u._id.toString()));
  const subordinateNames = subordinateUsers.map((u) => (u.name || '').toLowerCase().trim());
  const subordinateUsernames = subordinateUsers.map((u) => (u.username || '').toLowerCase().trim());
  const subordinateEmails = subordinateUsers.map((u) => (u.email || '').toLowerCase().trim());
  const subordinateIds = Array.from(subordinateIdsSet);

  const allowedUserIds = new Set([currentUserId, ...subordinateIds].filter(Boolean));
  const allowedNames = new Set([
    currentUserName,
    currentUserUsername,
    currentUserEmail,
    ...subordinateNames,
    ...subordinateUsernames,
    ...subordinateEmails,
  ].filter(Boolean));

  return {
    isSuperAdmin: false,
    currentUserId,
    currentUserName,
    currentUserUsername,
    currentUserEmail,
    allowedUserIds,
    allowedNames,
    subordinateIds,
    subordinateUsers,
  };
};

/**
 * Access checks per entity
 */
const isComplaintAccessible = (scope, complaint) => {
  if (!complaint) return false;
  if (scope.isSuperAdmin) return true;

  const cAssignedId = complaint.assignedTo
    ? (complaint.assignedTo._id ? complaint.assignedTo._id.toString() : complaint.assignedTo.toString()).trim()
    : '';
  const cAssignedName = (complaint.assignedToName || '').toLowerCase().trim();
  const cUserId = complaint.user ? (complaint.user._id ? complaint.user._id.toString() : complaint.user.toString()).trim() : '';
  const cCreatedById = complaint.createdBy ? (complaint.createdBy._id ? complaint.createdBy._id.toString() : complaint.createdBy.toString()).trim() : '';
  const cReportedBy = (complaint.reportedBy || '').toLowerCase().trim();

  if (cAssignedId && scope.allowedUserIds.has(cAssignedId)) return true;
  if (cUserId && scope.allowedUserIds.has(cUserId)) return true;
  if (cCreatedById && scope.allowedUserIds.has(cCreatedById)) return true;

  if (cAssignedName && cAssignedName !== 'unassigned' && scope.allowedNames.has(cAssignedName)) return true;
  if (cReportedBy && scope.allowedNames.has(cReportedBy)) return true;

  return false;
};

const isLeadAccessible = (scope, lead) => {
  if (!lead) return false;
  if (scope.isSuperAdmin) return true;

  if (lead.is_high_priority_pool || lead.assignedTo === 'Unassigned (High-Priority Queue)') {
    return true;
  }

  const lAssignedId = lead.assignedToId
    ? (lead.assignedToId._id ? lead.assignedToId._id.toString() : lead.assignedToId.toString()).trim()
    : (lead.user ? (lead.user._id ? lead.user._id.toString() : lead.user.toString()).trim() : '');
  const lAssignedName = (lead.assignedTo || lead.assignedSalesUser || '').toLowerCase().trim();
  const lAssignedById = lead.assignedById ? (lead.assignedById._id ? lead.assignedById._id.toString() : lead.assignedById.toString()).trim() : '';
  const lAssignedByName = (lead.assignedBy || '').toLowerCase().trim();
  const lCreatedById = lead.createdBy ? (lead.createdBy._id ? lead.createdBy._id.toString() : lead.createdBy.toString()).trim() : '';

  if (lAssignedId && scope.allowedUserIds.has(lAssignedId)) return true;
  if (lAssignedById && scope.allowedUserIds.has(lAssignedById)) return true;
  if (lCreatedById && scope.allowedUserIds.has(lCreatedById)) return true;

  if (lAssignedName && scope.allowedNames.has(lAssignedName)) return true;
  if (lAssignedByName && Array.from(scope.allowedNames).some(n => lAssignedByName.includes(n))) return true;

  return false;
};

const isTaskAccessible = (scope, task) => {
  if (!task) return false;
  if (scope.isSuperAdmin) return true;

  const tUserId = task.user ? (task.user._id ? task.user._id.toString() : task.user.toString()).trim() : '';
  const tAssignedName = (task.assignedTo || '').toLowerCase().trim();
  const tAssignedById = task.assignedById ? (task.assignedById._id ? task.assignedById._id.toString() : task.assignedById.toString()).trim() : '';
  const tAssignedByName = (task.assignedBy || '').toLowerCase().trim();

  if (tUserId && scope.allowedUserIds.has(tUserId)) return true;
  if (tAssignedById && scope.allowedUserIds.has(tAssignedById)) return true;

  if (tAssignedName && scope.allowedNames.has(tAssignedName)) return true;
  if (tAssignedByName && Array.from(scope.allowedNames).some(n => tAssignedByName.includes(n))) return true;

  return false;
};

const isOpportunityAccessible = (scope, opp) => {
  if (!opp) return false;
  if (scope.isSuperAdmin) return true;

  const oUserId = opp.user ? (opp.user._id ? opp.user._id.toString() : opp.user.toString()).trim() : '';
  const oAssignedId = opp.assignedToId ? (opp.assignedToId._id ? opp.assignedToId._id.toString() : opp.assignedToId.toString()).trim() : '';
  const oAssignedName = (opp.assignedTo || '').toLowerCase().trim();
  const oAssignedById = opp.assignedById ? (opp.assignedById._id ? opp.assignedById._id.toString() : opp.assignedById.toString()).trim() : '';
  const oAssignedByName = (opp.assignedBy || '').toLowerCase().trim();

  if (oUserId && scope.allowedUserIds.has(oUserId)) return true;
  if (oAssignedId && scope.allowedUserIds.has(oAssignedId)) return true;
  if (oAssignedById && scope.allowedUserIds.has(oAssignedById)) return true;

  if (oAssignedName && scope.allowedNames.has(oAssignedName)) return true;
  if (oAssignedByName && Array.from(scope.allowedNames).some(n => oAssignedByName.includes(n))) return true;

  return false;
};

const isProjectAccessible = (scope, project) => {
  if (!project) return false;
  if (scope.isSuperAdmin) return true;

  const pManagerId = project.manager ? (project.manager._id ? project.manager._id.toString() : project.manager.toString()).trim() : '';
  const pManagerName = (project.managerName || project.projectManager || '').toLowerCase().trim();
  const pOwnerId = project.owner ? (project.owner._id ? project.owner._id.toString() : project.owner.toString()).trim() : '';
  const pOwnerName = (project.ownerName || project.projectOwner || '').toLowerCase().trim();
  const pCreatedById = project.createdBy ? (project.createdBy._id ? project.createdBy._id.toString() : project.createdBy.toString()).trim() : '';
  const pUserId = project.user ? (project.user._id ? project.user._id.toString() : project.user.toString()).trim() : '';

  if (pManagerId && scope.allowedUserIds.has(pManagerId)) return true;
  if (pOwnerId && scope.allowedUserIds.has(pOwnerId)) return true;
  if (pCreatedById && scope.allowedUserIds.has(pCreatedById)) return true;
  if (pUserId && scope.allowedUserIds.has(pUserId)) return true;

  if (pManagerName && pManagerName !== 'unassigned' && scope.allowedNames.has(pManagerName)) return true;
  if (pOwnerName && pOwnerName !== 'unassigned' && scope.allowedNames.has(pOwnerName)) return true;

  const isTeamMatch = (project.teamMembers || []).some((m) => {
    const mUserId = m.userId ? (m.userId._id ? m.userId._id.toString() : m.userId.toString()) : (m.user ? (m.user._id ? m.user._id.toString() : m.user.toString()) : '');
    const mName = (m.name || m.userName || '').toLowerCase().trim();
    return (mUserId && scope.allowedUserIds.has(mUserId)) || (mName && scope.allowedNames.has(mName));
  });
  if (isTeamMatch) return true;

  const isTaskMatch = (project.tasks || []).some((t) => {
    const tUserId = t.assignedToId ? (t.assignedToId._id ? t.assignedToId._id.toString() : t.assignedToId.toString()) : '';
    const tName = (t.assignedTo || '').toLowerCase().trim();
    return (tUserId && scope.allowedUserIds.has(tUserId)) || (tName && tName !== 'unassigned' && scope.allowedNames.has(tName));
  });
  if (isTaskMatch) return true;

  const isMilestoneMatch = (project.milestones || []).some((ms) => {
    const msOwnerId = ms.owner ? (ms.owner._id ? ms.owner._id.toString() : ms.owner.toString()) : '';
    const msOwnerName = (ms.ownerName || '').toLowerCase().trim();
    return (msOwnerId && scope.allowedUserIds.has(msOwnerId)) || (msOwnerName && msOwnerName !== 'unassigned' && scope.allowedNames.has(msOwnerName));
  });
  if (isMilestoneMatch) return true;

  return false;
};

const isUserAccessible = (scope, targetUser) => {
  if (!targetUser) return false;
  if (scope.isSuperAdmin) return true;

  const targetId = (targetUser._id ? targetUser._id.toString() : (targetUser.id ? targetUser.id.toString() : '')).trim();
  return scope.allowedUserIds.has(targetId);
};

module.exports = {
  getAllUsers,
  getSubordinateUserIds,
  getUserScopeContext,
  isComplaintAccessible,
  isLeadAccessible,
  isTaskAccessible,
  isOpportunityAccessible,
  isProjectAccessible,
  isUserAccessible,
  escapeRegex,
};
